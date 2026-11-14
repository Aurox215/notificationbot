import { createServer, type Server } from 'node:http';
import type { Store } from '../persistence/store.js';
import type { IngestionConfig } from './config.js';
import { validateScan } from './schema.js';
import { AccountLinks } from './accounts.js';
import { log } from '../logging/logger.js';

export function createIngestionServer(store: Store, settings: IngestionConfig, accounts = new AccountLinks(store, settings.botUsername)): Server {
  const buckets = new Map<string, { count: number; until: number }>();
  const limited = (key: string, limit: number) => {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
    const bucket = buckets.get(key) ?? { count: 0, until: now + 60000 };
    if (!buckets.has(key) && buckets.size >= 1000) return true;
    bucket.count++; buckets.set(key, bucket); return bucket.count > limit;
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (code: number, value: unknown) => {
      if (!res.destroyed && !res.headersSent) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
    };
    const port = (server.address() as { port: number } | null)?.port;
    // Public HTTPS terminates at a same-host reverse proxy; the Node listener remains loopback-only.
    if (req.socket.remoteAddress !== '127.0.0.1' || ![new URL(settings.publicUrl).host, `127.0.0.1:${port}`].includes(req.headers.host ?? '')) {
      reply(403, { error: 'proxy_or_host_denied' }); return;
    }
    const origin = req.headers.origin;
    const extensionOrigin = typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    if (origin !== undefined && !extensionOrigin) { reply(403, { error: 'origin_denied' }); return; }
    if (extensionOrigin) res.setHeader('Access-Control-Allow-Origin', origin!);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      if (!extensionOrigin) { reply(403, { error: 'origin_denied' }); return; }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      reply(204, undefined); return;
    }
    const pairingRoute = req.method === 'POST' && ['/v1/pairings', '/v1/pairings/claim'].includes(req.url ?? '');
    const userId = accounts.authenticate(req.headers.authorization);
    if (!pairingRoute && !userId) { reply(401, { error: 'session_required' }); return; }
    const rateKey = userId ? `user:${userId}` : `pair:${req.socket.remoteAddress}:${req.url}`;
    if (limited(rateKey, userId ? 120 : req.url === '/v1/pairings' ? 20 : 180)) {
      res.setHeader('Retry-After', '60'); reply(429, { error: 'rate_limited' }); return;
    }
    if (req.method === 'GET' && ['/health', '/v1/session'].includes(req.url ?? '')) {
      reply(200, { ok: true, connected: true, mode: 'personal-browser', monitoring: store.browserSummary(userId!) }); return;
    }
    if (req.method === 'DELETE' && req.url === '/v1/session') {
      accounts.revoke(req.headers.authorization!); reply(200, { ok: true }); return;
    }
    if (req.method !== 'POST' || !['/v1/pairings', '/v1/pairings/claim', '/v1/ingest', '/v1/platform-access'].includes(req.url ?? '')) {
      reply(404, { error: 'not_found' }); return;
    }
    if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') { reply(415, { error: 'json_required' }); return; }
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk as Buffer);
        if (bytes > 256 * 1024) { reply(413, { error: 'batch_too_large' }); return; }
        chunks.push(Buffer.from(chunk as Buffer));
      }
      let data: unknown;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { reply(400, { error: 'invalid_json' }); return; }
      if (pairingRoute) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) { reply(400, { error: 'invalid_pairing' }); return; }
        const input = data as { pollSecret?: unknown; pairingId?: unknown };
        if (typeof input.pollSecret !== 'string') { reply(400, { error: 'invalid_pairing' }); return; }
        if (req.url === '/v1/pairings') {
          if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.pollSecret)) { reply(400, { error: 'invalid_pairing' }); return; }
          reply(201, accounts.start(input.pollSecret)); return;
        }
        if (typeof input.pairingId !== 'string') { reply(400, { error: 'invalid_pairing' }); return; }
        const result = accounts.claim(input.pairingId, input.pollSecret);
        reply(result.status === 'invalid' ? 410 : 200, result); return;
      }
      if (req.url === '/v1/platform-access') {
        const input = data as { platform?: unknown; status?: unknown } | null;
        if (!input || typeof input.platform !== 'string' || typeof input.status !== 'string' || !['PeoplePerHour', 'Guru'].includes(input.platform) || !['ok', 'login_required', 'verification_required'].includes(input.status)) { reply(400, { error: 'invalid_platform_status' }); return; }
        if (accounts.authenticate(req.headers.authorization) !== userId) { reply(401, { error: 'session_required' }); return; }
        store.recordAccess(userId!, input.platform as 'PeoplePerHour' | 'Guru', input.status as 'ok' | 'login_required' | 'verification_required');
        reply(200, { ok: true }); return;
      }
      let scan: ReturnType<typeof validateScan>;
      try { scan = validateScan(data); } catch {
        log('error', 'Browser batch rejected by validation.', { event: 'ingestion.rejected', errorCode: 'invalid_scan' });
        reply(400, { error: 'invalid_scan' }); return;
      }
      // A session can be revoked or expire while its request body is arriving.
      if (accounts.authenticate(req.headers.authorization) !== userId) { reply(401, { error: 'session_required' }); return; }
      // Ownership is derived solely from the authenticated session, never request fields.
      const result = store.ingestOwned(userId!, scan.platform, scan.projects);
      store.recordAccess(userId!, scan.platform, 'ok');
      const monitoring = store.browserSummary(userId!);
      log('info', 'Owner-scoped browser batch accepted.', { event: 'ingestion.accepted', platform: scan.platform,
        projectCount: scan.projects.length, inserted: result.inserted, baseline: result.baseline,
        matching: monitoring.matching, keywordExcluded: monitoring.keywordExcluded, alertsEnabled: monitoring.alertsEnabled });
      reply(200, { ...result, monitoring, acceptedAt: new Date().toISOString() });
    } catch {
      log('error', 'Browser request failed.', { event: 'ingestion.failed', errorCode: 'request_failed' });
      reply(500, { error: 'request_failed' });
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.timeout = 10000;
  return server;
}
export async function startIngestionServer(store: Store, settings: IngestionConfig, accounts?: AccountLinks): Promise<Server> {
  const server = createIngestionServer(store, settings, accounts);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(settings.port, '127.0.0.1', resolve); });
  return server;
}
