import { expect, it, vi } from 'vitest';
import { AutomaticRecovery } from './automaticRecovery.js';
import type { DesktopSharedInstall, DesktopSharedRuntime } from './sharedRuntime.js';
function fixture() {
  let now = 0;
  const install = { autoConnect: true, url: 'ws://local', token: 'secret', fingerprint: 'old', verificationGeneration: 'g1' } as DesktopSharedInstall;
  const deps = { install: vi.fn(() => install as DesktopSharedInstall | null), runtime: vi.fn(() => null as DesktopSharedRuntime | null),
    fingerprint: vi.fn(async () => 'new'), verify: vi.fn(async () => 'new'), now: () => now };
  return { deps, recovery: new AutomaticRecovery('ws://local', deps), advance: () => { now += 120_000; } };
}
it('prepares a changed build without any Desktop lifecycle dependency, once per identity', async () => {
  const {deps,recovery,advance} = fixture();
  await recovery.tick(false); advance(); await recovery.tick(false);
  expect(deps.verify).toHaveBeenCalledOnce(); expect(recovery.status.state).toBe('verified');
  deps.fingerprint.mockResolvedValue('newer'); advance(); await recovery.tick(false);
  expect(deps.verify).toHaveBeenCalledTimes(2);
});
it('skips connected, disabled and removed installations', async () => {
  const {deps,recovery,advance} = fixture(); await recovery.tick(true); expect(deps.install).not.toHaveBeenCalled();
  deps.install.mockReturnValue(null); await recovery.tick(false); advance();
  deps.install.mockReturnValue({autoConnect:false,url:'ws://local'} as DesktopSharedInstall); await recovery.tick(false);
  expect(deps.verify).not.toHaveBeenCalled();
});
it('never rearms a post-forwarding circuit breaker', async () => {
  const {deps,recovery} = fixture(); deps.runtime.mockReturnValue({url:'ws://local',mode:'blocked'} as DesktopSharedRuntime);
  await recovery.tick(false); expect(deps.verify).not.toHaveBeenCalled(); expect(recovery.status.state).toBe('blocked');
});
it('bounds transient retries and stops permanent incompatibility until the build changes', async () => {
  const {deps,recovery,advance} = fixture(); deps.verify.mockRejectedValue(new Error('ECONNRESET'));
  for(let i=0;i<6;i++){ await recovery.tick(false); advance(); }
  expect(deps.verify).toHaveBeenCalledTimes(3); expect(recovery.status.state).toBe('blocked');
  deps.fingerprint.mockResolvedValue('different'); deps.verify.mockRejectedValue(new Error('unsupported protocol'));
  await recovery.tick(false); advance(); await recovery.tick(false); expect(deps.verify).toHaveBeenCalledTimes(4);
});
it('coalesces concurrent polls and cancels probes on shutdown', async () => {
  const {deps,recovery} = fixture();
  let complete!: () => void; deps.verify.mockImplementation(async (_install, options) => {
    await new Promise<void>(resolve => { complete = resolve; }); options?.signal?.throwIfAborted(); return 'new';
  });
  const first = recovery.tick(false); await vi.waitFor(() => expect(deps.verify).toHaveBeenCalledOnce());
  const second = recovery.tick(false); expect(second).toBe(first); recovery.stop(); complete(); await first;
  await recovery.tick(false); expect(deps.verify).toHaveBeenCalledOnce();
});
it('reverifies transient private failure but leaves permanent failure for intervention', async () => {
  const {deps,recovery,advance} = fixture(); deps.fingerprint.mockResolvedValue('old');
  deps.runtime.mockReturnValue({url:'ws://local',mode:'private',fingerprint:'old',verificationGeneration:'g1',reason:'unsupported protocol'} as DesktopSharedRuntime);
  await recovery.tick(false); expect(recovery.status.state).toBe('blocked'); expect(deps.verify).not.toHaveBeenCalled();
  deps.runtime.mockReturnValue({url:'ws://local',mode:'private',fingerprint:'old',verificationGeneration:'g1',reason:'ECONNRESET'} as DesktopSharedRuntime);
  advance(); await recovery.tick(false); expect(deps.verify).toHaveBeenCalledOnce();
});

it('does not present a matching saved fingerprint as a live connection', async () => {
 const {deps,recovery}=fixture(); deps.fingerprint.mockResolvedValue('old');
 await recovery.tick(false); expect(deps.verify).not.toHaveBeenCalled();
 expect(recovery.status.state).toBe('verified'); expect(recovery.status.message).toContain('not connected');
});
