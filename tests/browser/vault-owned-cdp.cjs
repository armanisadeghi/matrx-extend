'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const DEADLINE_MS = 5_000;

async function prepareOwnedProfile(profileDir, fileSystem = fs) {
  const profile = path.resolve(profileDir);
  const stat = await fileSystem.lstat(profile);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('owned_cdp_profile_refused');
  try { await fileSystem.lstat(path.join(profile, 'DevToolsActivePort')); throw new Error('owned_cdp_endpoint_preexisted'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  return Object.freeze({ profile });
}

async function defaultProcessInspector(pid) {
  const options = { timeout: DEADLINE_MS, maxBuffer: 32768 };
  const [command, argumentsLine] = await Promise.all([
    execFileAsync('ps', ['-p', String(pid), '-o', 'comm='], options),
    execFileAsync('ps', ['-p', String(pid), '-o', 'args='], options),
  ]);
  return { executable: command.stdout.trim(), args: argumentsLine.stdout.trim() };
}
async function connectOwnedCdp({ preparedProfile, chromeExecutable, fileSystem = fs, WebSocketCtor = globalThis.WebSocket, processInspector = defaultProcessInspector, timeoutMs = DEADLINE_MS }) {
  if (!preparedProfile?.profile || typeof chromeExecutable !== 'string' || !WebSocketCtor) throw new Error('owned_cdp_configuration_refused');
  const profile = preparedProfile.profile;
  const deadline = Date.now() + timeoutMs;
  let raw;
  while (Date.now() < deadline) {
    try { raw = await fileSystem.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); break; } catch (error) { if (error?.code !== 'ENOENT') throw new Error('owned_cdp_endpoint_refused'); }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (typeof raw !== 'string') throw new Error('owned_cdp_endpoint_timeout');
  const lines = raw.split(/\r?\n/);
  if (lines.length === 3 && lines[2] === '') lines.pop();
  if (lines.length !== 2 || !/^[0-9]+$/.test(lines[0])) throw new Error('owned_cdp_endpoint_refused');
  const port = Number(lines[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(lines[1])) throw new Error('owned_cdp_endpoint_refused');
  let lock;
  try { lock = await fileSystem.readlink(path.join(profile, 'SingletonLock')); } catch { throw new Error('owned_cdp_owner_refused'); }
  const match = /-(\d+)$/.exec(lock);
  if (!match) throw new Error('owned_cdp_owner_refused');
  const owner = await processInspector(Number(match[1]));
  const escapedProfile = profile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasProfile = new RegExp(`(?:^|[\\s\\0])--user-data-dir=${escapedProfile}(?=$|[\\s\\0])`).test(String(owner?.args ?? ''));
  if (owner?.executable !== chromeExecutable || !hasProfile) throw new Error('owned_cdp_owner_refused');

  let socket; let fatal = false; let deliberateClose = false; let closing = false; let closeStatus = 'open'; let nextId = 0;
  const pending = new Map(); const listeners = new Map();
  const fail = () => {
    if (fatal) return;
    fatal = true;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('owned_cdp_transport_failed')); }
    pending.clear();
  };
  const dispatch = (data) => {
    if (typeof data !== 'string') return fail();
    let message; try { message = JSON.parse(data); } catch { return fail(); }
    if (!message || typeof message !== 'object') return fail();
    if (Object.hasOwn(message, 'id')) {
      if (!Number.isSafeInteger(message.id)) return fail();
      const entry = pending.get(message.id);
      if (!entry) return fail();
      const actual = Object.hasOwn(message, 'sessionId') ? message.sessionId : undefined;
      if (actual !== entry.sessionId || message.error || Object.hasOwn(message, 'method') || !Object.hasOwn(message, 'result') || !message.result || typeof message.result !== 'object' || Array.isArray(message.result)) { clearTimeout(entry.timer); pending.delete(message.id); entry.reject(new Error('owned_cdp_transport_failed')); return fail(); }
      clearTimeout(entry.timer); pending.delete(message.id); entry.resolve(message.result); return;
    }
    if (typeof message.method !== 'string' || (Object.hasOwn(message, 'sessionId') && typeof message.sessionId !== 'string')) return fail();
    try { for (const listener of listeners.get(message.method) ?? []) listener(message.params ?? {}, message.sessionId); } catch { fail(); }
  };
  socket = new WebSocketCtor(`ws://127.0.0.1:${port}${lines[1]}`);
  const closeSocket = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    socket.onclose = () => { clearTimeout(timer); resolve(); };
    try { socket.close(); } catch { clearTimeout(timer); resolve(); }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('owned_cdp_open_timeout')), timeoutMs);
    socket.onopen = () => { clearTimeout(timer); resolve(); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('owned_cdp_open_failed')); };
  }).catch(async () => { deliberateClose = true; await closeSocket(); throw new Error('owned_cdp_open_failed'); });
  socket.onmessage = (event) => dispatch(event.data);
  socket.onerror = () => fail();
  socket.onclose = () => { closeStatus = 'closed'; if (!deliberateClose) fail(); };
  return {
    ownerVerified: true,
    get fatal() { return fatal; },
    get closeStatus() { return closeStatus; },
    on(method, listener) { const set = listeners.get(method) ?? new Set(); set.add(listener); listeners.set(method, set); },
    off(method, listener) { listeners.get(method)?.delete(listener); },
    send(method, params = {}, sessionId) {
      if (fatal || closing || nextId >= Number.MAX_SAFE_INTEGER) { fail(); return Promise.reject(new Error('owned_cdp_transport_failed')); }
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); fail(); reject(new Error('owned_cdp_transport_failed')); }, timeoutMs);
        pending.set(id, { resolve, reject, timer, sessionId });
        try { socket.send(JSON.stringify(sessionId === undefined ? { id, method, params } : { id, method, params, sessionId })); } catch { clearTimeout(timer); pending.delete(id); fail(); reject(new Error('owned_cdp_transport_failed')); }
      });
    },
    async detach() {
      closing = true;
      closeStatus = 'closing';
      deliberateClose = true;
      const hadPending = pending.size > 0;
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('owned_cdp_transport_failed')); }
      pending.clear();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('owned_cdp_close_timeout')), timeoutMs);
        socket.onclose = () => { closeStatus = 'closed'; clearTimeout(timer); resolve(); };
        try { socket.close(); } catch { clearTimeout(timer); reject(new Error('owned_cdp_close_failed')); }
      }).catch((error) => { fail(); throw error; });
      if (fatal || hadPending) throw new Error('owned_cdp_transport_failed');
    },
  };
}
exports.prepareOwnedProfile = prepareOwnedProfile;
exports.connectOwnedCdp = connectOwnedCdp;
