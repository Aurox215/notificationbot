import { createServer, type Server } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Store } from '../persistence/store.js';
import type { IngestionConfig } from './config.js';
import { validateScan } from './schema.js';
import { initialHealth, sourceHealthKey } from '../monitoring/source-runner.js';
import { log } from '../logging/logger.js';

export function createIngestionServer(store: Store, settings: IngestionConfig): Server {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  const expectedToken = digest(`Bearer ${settings.token}`);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (code: number, value: unknown) => {
      if (!res.destroyed) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
    };
    const port = (server.address() as { port: number } | null)?.port;
    if (req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== `127.0.0.1:${port}`) { reply(403, { error: 'local_only' }); return; }
    // Privileged extension requests can omit Origin. A bearer token is mandatory either way.
    // Accept different extension installations without an ID allowlist. Origin is a browser
    // boundary, not identity: the secret bearer token authorizes every actual request.
    const origin = req.headers.origin;
    const extensionOrigin = typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    if (origin !== undefined && !extensionOrigin) { reply(403, { error: 'origin_denied' }); return; }
    if (extensionOrigin) res.setHeader('Access-Control-Allow-Origin', origin!);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      if (!extensionOrigin) { reply(403, { error: 'origin_denied' }); return; }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      reply(204, undefined); return;
    }
    if (!timingSafeEqual(expectedToken, digest(req.headers.authorization ?? ''))) { reply(401, { error: 'unauthorized' }); return; }
    if (req.method === 'GET' && req.url === '/health') { reply(200, { ok: true, mode: 'manual-extension' }); return; }
    if (req.method !== 'POST' || req.url !== '/v1/ingest') { reply(404, { error: 'not_found' }); return; }
    if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') { reply(415, { error: 'json_required' }); return; }
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk as Buffer);
        if (bytes > 256 * 1024) { reply(413, { error: 'batch_too_large' }); return; }
        chunks.push(Buffer.from(chunk as Buffer));
      }
      let scan: ReturnType<typeof validateScan>;
      try { scan = validateScan(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reply(400, { error: 'invalid_scan' }); return; }
      const result = store.ingest(scan.platform, scan.projects);
      const now = Date.now();
      store.setState(sourceHealthKey(scan.platform), JSON.stringify({ ...initialHealth(scan.platform),
        status: 'healthy', lastAttemptAt: now, lastSuccessAt: now, nextAttemptAt: null, projectCount: scan.projects.length }));
      log('info', 'Manual extension batch accepted.', { event: 'ingestion.accepted', platform: scan.platform, projectCount: scan.projects.length });
      reply(200, { ...result, acceptedAt: new Date(now).toISOString() });
    } catch { log('error', 'Manual ingestion failed.', { event: 'ingestion.failed', errorCode: 'ingestion_failed' }); reply(500, { error: 'ingestion_failed' }); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.timeout = 10000;
  return server;
}

export async function startIngestionServer(store: Store, settings: IngestionConfig): Promise<Server> {
  const server = createIngestionServer(store, settings);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(settings.port, '127.0.0.1', resolve); });
  return server;
}
