import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
interface Owner { pid: number; token: string }
export async function acquireDatabaseLock(databasePath: string): Promise<() => Promise<void>> {
  const absolute = resolve(databasePath);
  const key = createHash('sha256').update(process.platform === 'win32' ? absolute.toLowerCase() : absolute).digest('hex').slice(0, 32);
  // Windows named pipes and Linux abstract sockets are released by the OS after
  // a crash. They also serialize stale-file recovery between simultaneous starts.
  const address = process.platform === 'win32' ? '\\\\.\\pipe\\bidbot-' + key
    : process.platform === 'linux' ? '\0bidbot-' + key : join(tmpdir(), 'bidbot-' + key + '.sock');
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((accept, reject) => {
    const onError = (error: NodeJS.ErrnoException) => reject(error.code === 'EADDRINUSE'
      ? new Error('Another bot instance owns this database. Stop that instance before starting another.') : error);
    server.once('error', onError);
    server.listen(address, () => { server.removeListener('error', onError); accept(); });
  });
  const close = () => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
  const path = absolute + '.lock';
  const owner: Owner = { pid: process.pid, token: randomUUID() };
  try {
    let existing: string | undefined;
    try { existing = readFileSync(path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (existing !== undefined) {
      let previous: Partial<Owner>;
      try { previous = JSON.parse(existing) as Partial<Owner>; }
      catch { throw new Error('Legacy or damaged database lock found. Confirm no old bot is running before removing its .lock file.'); }
      if (!previous || !Number.isSafeInteger(previous.pid) || previous.pid! <= 0 || typeof previous.token !== 'string') {
        throw new Error('Invalid database lock ownership. Confirm no old bot is running before removing its .lock file.');
      }
      let alive = true;
      try { process.kill(previous.pid!, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw error; }
      if (alive) throw new Error('Database lock belongs to running process ' + previous.pid + '. Stop that instance before restarting.');
      // The OS lock remains held throughout replacement.
    }
    writeFileSync(path, JSON.stringify(owner), { mode: 0o600 });
  } catch (error) { await close(); throw error; }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      const current = JSON.parse(readFileSync(path, 'utf8')) as Owner;
      if (current.pid === owner.pid && current.token === owner.token) unlinkSync(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    finally { await close(); }
  };
}
