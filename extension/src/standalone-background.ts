import { localStore } from './standalone-api.js';
import { diagnostic, DiagnosticError } from './diagnostics.js';
import { listingUrlPage } from './listing-evidence.js';
import { listingPlatform } from '../shared/identity.js';
import type { Platform } from '../shared/types.js';
import type { Extraction } from './extractor.js';
const sites = ['https://www.peopleperhour.com/*', 'https://www.guru.com/*'];
const alarmName = 'aurox-standalone-monitor';
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).then(() => localStore().status());
const scanning = new Set<number>();
const checking = new Set<number>();
const authPending = new Map<number, Pick<chrome.tabs.Tab, 'id' | 'url'>>();
let sweeping = false;
function supported(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.port && !url.username && !url.password && ['www.peopleperhour.com', 'www.guru.com'].includes(url.hostname); }
  catch { return false; }
}
function platform(value: string): Platform { return new URL(value).hostname === 'www.guru.com' ? 'Guru' : 'PeoplePerHour'; }
async function pageMessage(tabId: number, message: object, timeout = 12000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([chrome.tabs.sendMessage(tabId, message), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new DiagnosticError('content_script_unavailable', 'content_script', 'Refresh this platform tab after reloading the extension. The page content script did not respond.')), timeout);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function verify(tab: Pick<chrome.tabs.Tab, 'id' | 'url'>, force = false) {
  await ready;
  if (tab.id === undefined || !tab.url || !supported(tab.url) || !(await localStore().status()).connected) return;
  if (checking.has(tab.id)) { if (force) authPending.set(tab.id, tab); return; }
  checking.add(tab.id);
  try {
    const result = await pageMessage(tab.id, { type: 'CHECK_AUTH', force });
    const auth = result?.authentication;
    await localStore().recordAuthenticationIssue(platform(tab.url), !auth || auth.state === 'unknown' ? auth?.detail ?? platform(tab.url) + ': account status could not be verified. Refresh this platform tab.' : '');
    if (auth?.state === 'authenticated' && auth.reason === 'api_authenticated') {
      const site = platform(tab.url);
      await localStore().recordAccess(site, 'authenticated');
      const tabs = await chrome.tabs.query({ url: sites });
      const available = tabs.some(candidate => candidate.url && supported(candidate.url) && !candidate.discarded && listingPlatform(candidate.url) === site && listingUrlPage(candidate.url) === 'first');
      await localStore().recordListingPresence(site, available);
    }
    if (auth?.state === 'expired/logged_out' && auth.reason === 'api_rejected') await localStore().recordAccess(platform(tab.url), 'login_required');
  } catch (error) { await localStore().recordAuthenticationIssue(platform(tab.url), platform(tab.url) + ': ' + diagnostic(error).message); }
  finally {
    checking.delete(tab.id);
    const pending = authPending.get(tab.id); authPending.delete(tab.id);
    if (pending) void verify(pending, true);
  }
}
async function saveScan(value: Extraction, pageUrl: string) {
  if (value.status === 'verification_required') await localStore().recordAccess(platform(pageUrl), 'verification_required');
  let result: Record<string, unknown> = { accepted: false, detail: value.detail };
  if ((value.status === 'ok' || (value.status === 'no_projects' && value.payload?.listing?.completeness === 'empty')) && value.payload && listingPlatform(value.payload.pageUrl) === listingPlatform(pageUrl)) {
    const current = await localStore().status();
    if (current.platformAccess[platform(pageUrl)]?.status === 'login_required') result.detail = 'Collection paused after API-confirmed logout. Sign in normally; a successful API check will resume it.';
    else result = await localStore().ingest(value.payload);
  }
  if (listingPlatform(pageUrl)) {
    const issue = result.accepted !== true ? platform(pageUrl) + ': ' + result.detail : result.conservative
      ? platform(pageUrl) + ': the listing scan is incomplete; job alerts are waiting for a complete first-page scan.'
      : value.payload!.projects.length > 0 && value.payload!.projects.every(project => !project.publishedAt)
        ? platform(pageUrl) + ': jobs were found but their posting times could not be read, so new-job alerts cannot be sent. Refresh this jobs tab after updating the extension.' : '';
    await localStore().recordMonitoringIssue(platform(pageUrl), issue);
  }
  return result;
}
async function scanTab(tab: chrome.tabs.Tab, poll: boolean) {
  if (tab.id === undefined || !tab.url || !supported(tab.url) || scanning.has(tab.id)) return;
  scanning.add(tab.id);
  try {
    await verify(tab);
    const status = await localStore().status();
    if (!status.connected || !status.scanningEnabled || status.platformAccess[platform(tab.url)]?.status === 'login_required') return;
    const value = await pageMessage(tab.id, { type: poll && status.baselineReady[platform(tab.url)] ? 'POLL_PAGE' : 'SCAN_PAGE' }, 15000) as Extraction;
    if (!value || typeof value.status !== 'string' || typeof value.detail !== 'string') throw new DiagnosticError('extraction_invalid', 'content_script', 'The platform page returned an invalid scan.');
    await saveScan(value, tab.url);
  } catch (error) { await localStore().recordMonitoringIssue(platform(tab.url), platform(tab.url) + ': ' + diagnostic(error).message); } finally { scanning.delete(tab.id); }
}
async function syncAlarm() {
  await ready;
  const status = await localStore().status();
  if (status.connected || status.verificationPending) {
    if (!await chrome.alarms.get(alarmName)) await chrome.alarms.create(alarmName, { periodInMinutes: 0.5 });
  } else await chrome.alarms.clear(alarmName);
}
async function resumeMonitoring() {
  for (const tab of await chrome.tabs.query({ url: sites })) if (tab.id !== undefined) void chrome.tabs.sendMessage(tab.id, { type: 'RESCAN' }).catch(() => {});
}
async function sweep() {
  if (sweeping) return; sweeping = true;
  try {
    await ready; const before = await localStore().status(); await localStore().pulse();
    const current = await localStore().status();
    if (!current.connected) return;
    if (!before.connected) await resumeMonitoring();
    const polled = new Set<Platform>();
    for (const tab of await chrome.tabs.query({ url: sites })) {
      if (!tab.url || tab.discarded || tab.status === 'loading' || !supported(tab.url)) continue;
      if (!current.scanningEnabled || !listingPlatform(tab.url)) { await verify(tab); continue; }
      const site = platform(tab.url); if (polled.has(site)) continue;
      const key = 'standalonePoll:' + site; const previous = Number((await chrome.storage.local.get(key))[key] ?? 0);
      if (Date.now() - previous < 30000) { await verify(tab); continue; }
      polled.add(site); await chrome.storage.local.set({ [key]: Date.now() }); await scanTab(tab, true);
    }
  } finally { sweeping = false; await syncAlarm(); }
}
interface Message { type?: string; chatId?: string; botToken?: string; code?: string; extraction?: Extraction }
async function handle(message: Message, sender: chrome.runtime.MessageSender) {
  await ready;
  const store = localStore();
  if (message.type === 'GET_SCAN_STATE') { const state = await store.status(); return { enabled: state.connected && state.scanningEnabled }; }
  if (message.type === 'AUTO_SCAN') {
    if (sender.tab?.id === undefined || !sender.url || !message.extraction) throw new DiagnosticError('scan_invalid', 'extension', 'Invalid page scan.');
    const current = await store.status(); if (!current.connected || !current.scanningEnabled) return { accepted: false, detail: 'Connect Telegram and enable scanning first.' };
    if (message.extraction.payload && listingPlatform(message.extraction.payload.pageUrl) !== listingPlatform(sender.url)) throw new DiagnosticError('scan_invalid', 'extension', 'Scan source does not match this page.');
    await verify({ id: sender.tab.id, url: sender.url });
    return saveScan(message.extraction, sender.url);
  }
  if (message.type === 'CONNECT') {
    if (chrome.permissions?.contains && !await chrome.permissions.contains({ origins: ['https://api.telegram.org/*'] })) throw new DiagnosticError('telegram_permission_missing', 'telegram', 'Allow this extension to access api.telegram.org in Chrome extension settings, then try Connect again.');
    const result = await store.beginConnection(message.chatId ?? '', message.botToken); await syncAlarm();
    if (result.provisionedChatId) await chrome.tabs.create({ url: 'https://t.me/Aurox_notification_bot?start=extension', active: true });
    if (result.connected) await resumeMonitoring();
    return result;
  }
  if (message.type === 'CONFIRM_CONNECTION') {
    const result = await store.confirmConnection(message.code ?? ''); await syncAlarm();
    await resumeMonitoring();
    return result;
  }
  if (message.type === 'DISCONNECT') { const result = await store.disconnect(); await syncAlarm(); return result; }
  if (message.type === 'CHECK_CONNECTION') { const before = await store.status(); const result = await store.checkConnection(); await syncAlarm(); if (!before.connected && result.connected) await resumeMonitoring(); if (result.connected) await Promise.all((await chrome.tabs.query({ url: sites })).filter(tab => !tab.discarded && tab.status !== 'loading').map(tab => verify(tab, true))); return store.status(); }
  if (message.type === 'TOGGLE_SCAN') {
    const current = await store.status(); const next = await store.setScanning(!current.scanningEnabled);
    for (const tab of await chrome.tabs.query({ url: sites })) if (tab.id !== undefined) void chrome.tabs.sendMessage(tab.id, { type: 'SCAN_STATE_CHANGED', enabled: next.connected && next.scanningEnabled }).catch(() => {});
    return next;
  }
  if (message.type === 'GET_STATUS') return store.status();
  throw new DiagnosticError('action_unknown', 'extension', 'Unsupported extension action.');
}
chrome.runtime.onMessage.addListener((message: Message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const popup = sender.url === chrome.runtime.getURL('standalone.html');
  if (!popup && (!['AUTO_SCAN', 'GET_SCAN_STATE'].includes(message?.type ?? '') || sender.frameId !== 0 || !sender.url || !supported(sender.url))) return;
  if (popup && message.type === 'AUTO_SCAN') return;
  void handle(message, sender).then(result => reply({ ok: true, ...result }), error => { const failure = diagnostic(error); reply({ ok: false, errorCode: failure.code, error: failure.message }); });
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === alarmName) void sweep().catch(() => {}); });
chrome.runtime.onStartup?.addListener(() => { void sweep().catch(() => {}); });
chrome.runtime.onInstalled?.addListener(() => { void syncAlarm().catch(() => {}); });
chrome.tabs.onUpdated?.addListener((_id, change, tab) => { if ((change.status === 'complete' || change.url) && tab.url && supported(tab.url)) void verify(tab, true); });
chrome.tabs.onRemoved?.addListener(() => { void chrome.tabs.query({ url: sites }).then(tabs => Promise.all(tabs.filter(tab => !tab.discarded && tab.status !== 'loading').map(tab => verify(tab, true)))).catch(() => {}); });
chrome.webRequest?.onCompleted.addListener(details => {
  if (details.tabId < 0) return;
  let url: URL; try { url = new URL(details.url); } catch { return; }
  if (supported(url.href) && /\/(?:login|logout|signin|signout)(?:\.aspx)?\/?$/i.test(url.pathname)) void chrome.tabs.get(details.tabId).then(tab => verify(tab, true)).catch(() => {});
}, { urls: sites, types: ['xmlhttprequest'] });
void syncAlarm().catch(() => {});