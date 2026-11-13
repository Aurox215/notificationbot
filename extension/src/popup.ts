const get = (id: string) => document.getElementById(id)!;
const scan = get('scan') as HTMLButtonElement;
async function refresh(type: 'GET_STATUS' | 'SCAN' = 'GET_STATUS'): Promise<void> {
  scan.disabled = true;
  try {
    const state = await chrome.runtime.sendMessage({ type });
    if (!state?.ok) throw new Error(state?.error ?? 'Extension unavailable.');
    get('website').textContent = state.website;
    get('count').textContent = String(state.count);
    get('lastSuccess').textContent = state.lastSuccess ? new Date(state.lastSuccess).toLocaleString() : 'Never';
    get('connection').textContent = state.connection;
    get('status').textContent = `${state.status}: ${state.detail}`;
    scan.disabled = !state.supported;
  } catch (error) { get('status').textContent = (error as Error).message; scan.disabled = false; }
}
scan.addEventListener('click', () => { void refresh('SCAN'); });
get('pairing').addEventListener('submit', event => {
  event.preventDefault();
  const token = get('token') as HTMLInputElement;
  const port = get('port') as HTMLInputElement;
  void chrome.runtime.sendMessage({ type: 'SAVE_PAIRING', token: token.value.trim(), port: Number(port.value) }).then(async result => {
    token.value = '';
    get('connection').textContent = result?.ok ? 'Connected' : result?.error ?? 'Pairing failed.';
    if (result?.ok) await refresh();
  }).catch(() => { get('connection').textContent = 'Pairing failed.'; });
});
void refresh();
