/** Live spike #2: external-thread visibility + fixed turn lifecycle. */
import { mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RpcConnection } from '../src/harness/codex-app-server/rpc.js';

const conn = RpcConnection.spawn('codex', ['app-server']);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11), ...a);
const t0 = Date.now();

conn.on('notification', (method, params) => {
  const p = params as { threadId?: string } & Record<string, unknown>;
  if (method.startsWith('item/') || method.startsWith('turn/') || method.startsWith('thread/')) {
    log('NOTIF', method, JSON.stringify(p).slice(0, 200));
  }
});
conn.on('serverRequest', (id, method) => {
  log('SERVERREQ', method, '→ rejecting');
  conn.rejectServer(id, 'not handled by spike');
});

await conn.request('initialize', {
  clientInfo: { name: 'stream-deck-micro', title: 'Stream Deck Micro', version: '0.2.0' },
});
conn.notify('initialized');

// 1. External thread visibility: Rust Star, currently driven by the desktop app
const RUST_STAR = '01a001ee-6f4c-7b61-ac12-abbaa521efa6';
const read = (await conn.request('thread/read', { threadId: RUST_STAR })) as {
  thread: {
    name?: string | null;
    status?: { type: string; activeFlags?: string[] };
    turns?: { data?: { id: string; status: string; startedAt?: number; completedAt?: number }[] };
  };
};
log(
  `thread/read RustStar (${Date.now() - t0}ms): name=${JSON.stringify(read.thread.name)} status=${JSON.stringify(read.thread.status)}`,
);
const turns = read.thread.turns?.data ?? [];
log(`  turns: ${turns.length}, last 3 statuses:`, turns.slice(-3).map((t) => t.status).join(', '));

// 2. thread/list: does list carry live status for external threads?
const listed = (await conn.request('thread/list', { limit: 8 })) as {
  data: { id: string; name?: string; status?: { type: string } }[];
};
const rs = listed.data.find((t) => t.id === RUST_STAR);
log('thread/list RustStar full entry:', JSON.stringify(rs));

// 3. Full turn lifecycle on a scratch thread with correct sandbox param
const dir = mkdtempSync(join(tmpdir(), 'sdm-appserver2-'));
execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
const started = (await conn.request('thread/start', {
  cwd: dir,
  approvalPolicy: 'never',
  sandbox: 'workspace-write',
})) as { thread: { id: string } };
const scratchId = started.thread.id;
log('thread/start →', scratchId);

const turnResp = await conn.request('turn/start', {
  threadId: scratchId,
  input: [{ type: 'text', text: 'Run `echo appserver-hello` in the shell and reply with only its output.' }],
});
log('turn/start →', JSON.stringify(turnResp).slice(0, 200));
await new Promise((r) => setTimeout(r, 25000)); // watch notifications

// 4. interrupt via thread/read's active turn id
const active = (await conn.request('thread/read', { threadId: scratchId })) as {
  thread: { turns?: { data?: { id: string; status: string }[] } };
};
const last = active.thread.turns?.data?.at(-1);
log('scratch last turn:', JSON.stringify(last).slice(0, 120));
if (last && last.status === 'inProgress') {
  await conn.request('turn/interrupt', { threadId: scratchId, turnId: last.id });
  log('interrupt sent for', last.id);
  await new Promise((r) => setTimeout(r, 3000));
  const after = (await conn.request('thread/read', { threadId: scratchId })) as {
    thread: { turns?: { data?: { id: string; status: string }[] } };
  };
  log('after interrupt:', after.thread.turns?.data?.at(-1)?.status);
}
conn.close();
process.exit(0);
