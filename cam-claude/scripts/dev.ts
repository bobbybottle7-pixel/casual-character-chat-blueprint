/**
 * Start, stop and check the dev server.
 *
 * This exists because killing the server by matching its command line also
 * matches the shell that is doing the matching, which kills the caller. A pid
 * file makes stopping unambiguous.
 *
 *   npm run dev:start    start in the background, wait until it answers
 *   npm run dev:stop     stop it
 *   npm run dev:restart  stop, then start
 *   npm run dev:status   is it up, and on what
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pidFile = join(root, 'data', 'dev-server.pid');
const logFile = join(root, 'data', 'dev-server.log');
const baseUrl = `http://127.0.0.1:${process.env.PORT || 8787}`;

function readPid(): number | null {
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0); // Signal 0 tests for existence without signalling.
    return pid;
  } catch {
    unlinkSync(pidFile);
    return null;
  }
}

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitUntil(want: boolean, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await isUp()) === want) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function start() {
  if (await isUp()) {
    console.log(`already running at ${baseUrl}`);
    return;
  }
  mkdirSync(dirname(pidFile), { recursive: true });

  // Give the child the log file descriptor directly. Piping instead and
  // forwarding the output would keep this process's event loop alive, so the
  // command would never return.
  const { openSync } = await import('node:fs');
  const log = openSync(logFile, 'a');
  const child = spawn('npx', ['tsx', join(root, 'server', 'index.ts')], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
  });
  child.unref();

  writeFileSync(pidFile, String(child.pid));

  if (await waitUntil(true)) {
    console.log(`started (pid ${child.pid}) at ${baseUrl}`);
  } else {
    console.error(`failed to start — last output:\n${tailLog()}`);
    process.exit(1);
  }
}

async function stop() {
  const pid = readPid();
  if (pid === null) {
    // No pid file, but something may still hold the port from an earlier run.
    console.log((await isUp()) ? `no pid file, but ${baseUrl} is still answering` : 'not running');
    return;
  }
  // `npx tsx` spawns node as a grandchild, so signalling the pid alone leaves
  // the real server running and holding the port. `detached: true` puts the
  // child in its own process group; a negative pid signals the whole group.
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // Already gone.
      }
    }
  };

  signalGroup('SIGTERM');
  if (!(await waitUntil(false, 8000))) signalGroup('SIGKILL');
  if (existsSync(pidFile)) unlinkSync(pidFile);

  if (await isUp()) {
    console.error(
      `stopped pid ${pid}, but ${baseUrl} is still answering — another server is holding the port.`,
    );
    process.exit(1);
  }
  console.log(`stopped (pid ${pid})`);
}

function tailLog(lines = 15): string {
  if (!existsSync(logFile)) return '(no log)';
  return readFileSync(logFile, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
}

async function status() {
  const pid = readPid();
  const up = await isUp();
  console.log(`  url:     ${baseUrl}`);
  console.log(`  running: ${up ? 'yes' : 'no'}${pid ? ` (pid ${pid})` : ''}`);
  if (up) {
    const health = (await (await fetch(`${baseUrl}/api/health`)).json()) as {
      auth: { kind: string; detail: string };
    };
    console.log(`  auth:    ${health.auth.kind} — ${health.auth.detail}`);
  } else {
    console.log(`  last output:\n${tailLog(8)}`);
  }
}

const command = process.argv[2] ?? 'status';
if (command === 'start') await start();
else if (command === 'stop') await stop();
else if (command === 'restart') {
  await stop();
  await start();
} else if (command === 'status') await status();
else if (command === 'log') console.log(tailLog(40));
else {
  console.error(`unknown command "${command}" — use start, stop, restart, status or log`);
  process.exit(1);
}
