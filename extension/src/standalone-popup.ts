export {};
const element = (id: string) => document.getElementById(id)!;
const input = (id: string) => element(id) as HTMLInputElement;
interface State {
  provisionedChatId?: string; automaticSetup?: boolean;
  connected: boolean; chatId: string; tokenConfigured: boolean; verificationPending: boolean; pendingChatId: string; verificationDelivery: string;
  scanningEnabled: boolean; lastError: string; monitoringIssue?: string;
}
let current: State | undefined;
let busy = false;
let chatError = '';
function renderChatValidation() {
  const field = input('chatId');
  const verified = Boolean(current?.connected && current.chatId === field.value.trim());
  const value = field.value.trim();
  const validFormat = /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
  const invalid = Boolean(chatError) || Boolean(value && !validFormat);
  field.classList.toggle('chat-invalid', invalid);
  field.classList.toggle('chat-valid', validFormat && !invalid);
  field.setAttribute('aria-invalid', String(invalid));
  element('chatFeedback').textContent = chatError || (verified ? 'Telegram connected.' : current?.verificationPending && current.pendingChatId === field.value.trim() ? (current.automaticSetup ? 'Connecting to Telegram. Use Check connection to refresh.' : 'Enter the code sent to you in Telegram.') : validFormat ? 'ID format looks correct. Click Connect Telegram to connect.' : '');
}
let setupTimer: ReturnType<typeof setTimeout> | undefined;
function controls() {
  (element('connect') as HTMLButtonElement).disabled = busy || Boolean(current?.connected) || Boolean(current?.automaticSetup && !['unknown', 'failed'].includes(current.verificationDelivery));
  (element('confirm') as HTMLButtonElement).disabled = busy || !current?.verificationPending;
  (element('toggle') as HTMLButtonElement).disabled = busy || !current?.connected;
  element('toggle').textContent = current?.scanningEnabled ? 'Pause monitoring' : 'Resume monitoring';
  (element('check') as HTMLButtonElement).disabled = busy;
  (element('disconnect') as HTMLButtonElement).disabled = busy;
  element('toggle').hidden = !current?.connected;
  element('disconnect').hidden = !current?.connected && !current?.verificationPending;
  element('setup').hidden = false;
  input('chatId').readOnly = busy || Boolean(current?.connected || current?.provisionedChatId);
  renderChatValidation();
  element('tokenSetup').hidden = Boolean(current?.connected || current?.tokenConfigured);
  element('botAccess').hidden = Boolean(current?.connected) || !/press Start|unblock|Waiting for Telegram Start/.test(chatError || current?.lastError || '');
  element('verification').hidden = !current?.verificationPending || Boolean(current?.automaticSetup);
}
async function refresh() {
  if (setupTimer) clearTimeout(setupTimer);
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (!response?.ok) throw new Error();
    current = response as State;
    element('connection').textContent = current.connected ? 'Telegram connected.' : current.automaticSetup ? 'Connecting to Telegram...'  : current.verificationPending ? 'Check Telegram for your connection code.' : 'Telegram is disconnected.';
    element('confirmation').textContent = current.verificationDelivery === 'pending' ? 'Waiting to send your code. Please try Check connection shortly.' : 'Enter the code received in Telegram.';
    element('status').textContent = current.lastError || current.monitoringIssue || '';
    element('status').hidden = !current.lastError && !current.monitoringIssue;
    if (current.provisionedChatId) input('chatId').value = current.provisionedChatId;
    else if (current.connected) input('chatId').value = current.chatId;
    element('chatLabel').textContent = current.provisionedChatId ? 'Telegram account ready to connect' : '2. Paste your Telegram account ID';
    element('idHelp').hidden = Boolean(current.provisionedChatId || current.connected);
    if (current.automaticSetup && !['unknown', 'failed'].includes(current.verificationDelivery)) setupTimer = setTimeout(() => { void action('CHECK_CONNECTION'); }, 5000);
  } catch {
    current = undefined; element('connection').textContent = 'Extension status unavailable. Reload the extension.';
    (element('toggle') as HTMLButtonElement).disabled = true;
  }
  controls();
}
async function action(type: string, values: Record<string, unknown> = {}) {
  if (type === 'CONNECT' || type === 'DISCONNECT') chatError = '';
  busy = true; controls(); element('status').hidden = false; element('status').textContent = 'Working...';
  try {
    const result = await chrome.runtime.sendMessage({ type, ...values }); await refresh();
    if (!result?.ok) {
      element('status').hidden = false;
      element('status').textContent = result?.error ?? 'Extension action failed.';
      if (type === 'CONNECT' && ['telegram_chat_invalid', 'telegram_chat_unavailable', 'telegram_chat_forbidden'].includes(result?.errorCode)) chatError = result.error;
    }
  } catch { element('status').hidden = false; element('status').textContent = 'Extension action did not respond. Reload the extension and try again.'; }
  finally { busy = false; controls(); }
}
input('chatId').addEventListener('input', () => {
  const value = input('chatId').value.trim();
  chatError = value && (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) ? 'Enter the ID number shown by the Telegram ID helper.' : '';
  renderChatValidation();
});
element('connect').addEventListener('click', () => {
  const value = input('chatId').value.trim();
  if (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) { chatError = 'Enter the ID number shown by the Telegram ID helper.'; renderChatValidation(); input('chatId').focus(); return; }
  const botToken = input('botToken').value.trim(); input('botToken').value = ''; void action('CONNECT', { chatId: input('chatId').value.trim(), ...(botToken ? { botToken } : {}) }); });
element('confirm').addEventListener('click', () => { const code = input('connectionCode').value.trim(); input('connectionCode').value = ''; void action('CONFIRM_CONNECTION', { code }); });
element('disconnect').addEventListener('click', () => { void action('DISCONNECT'); });
element('toggle').addEventListener('click', () => { void action('TOGGLE_SCAN'); });
element('check').addEventListener('click', () => { void action('CHECK_CONNECTION'); });
void refresh();
