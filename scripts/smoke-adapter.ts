/** Live smoke: real codex via the adapter. Not part of unit tests. */
import { mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAdapter } from '../src/harness/codex/adapter.js';

const dir = mkdtempSync(join(tmpdir(), 'sdm-smoke-'));
execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });

const adapter = new CodexAdapter({ sandboxMode: 'workspace-write', approvalPolicy: 'never' });
const session = await adapter.createSession({ cwd: dir });
session.onEvent((e) => console.log(new Date().toISOString(), e.type, 'detail' in e ? JSON.stringify(e).slice(0, 160) : ''));

console.log('--- sending turn 1');
await session.send('Run the shell command `echo hello-from-codex` and reply with its output only.');
console.log('sessionId after turn:', session.sessionId);
console.log('name:', session.name);

console.log('--- sending turn 2 (continuity check)');
await session.send('What did I ask you to run? Answer in five words or fewer.');
console.log('--- interrupt check: sending slow turn');
const slow = session.send('Count slowly from 1 to 1000000, one number per line.').catch((e) =>
  console.log('slow turn ended with:', String(e).slice(0, 100)),
);
await new Promise((r) => setTimeout(r, 8000));
session.interrupt();
await slow;
console.log('--- done, sessionId:', session.sessionId);
rmSync(dir, { recursive: true, force: true });
process.exit(0);
