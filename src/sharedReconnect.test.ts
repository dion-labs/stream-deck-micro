import { expect, it, vi } from 'vitest';
import { reconnectSharedDesktop } from './sharedReconnect.js';
function fixture() { return { preflight: vi.fn(), running: vi.fn(() => true), verify: vi.fn(async () => {}), restart: vi.fn(async () => {}) }; }
it('refuses unsupported recovery before checking processes, reinstalling, or restarting', async () => {
 const d=fixture(); d.preflight.mockImplementation(() => { throw new Error('Modern recovery unsupported'); });
 await expect(reconnectSharedDesktop('config','ws://local',true,d)).rejects.toThrow('unsupported');
 expect(d.running).not.toHaveBeenCalled(); expect(d.verify).not.toHaveBeenCalled(); expect(d.restart).not.toHaveBeenCalled();
});
it('requires explicit approval before changing an active Desktop', async () => {
 const d=fixture(); await expect(reconnectSharedDesktop('config', 'ws://local', false, d)).rejects.toThrow('Confirm');
 expect(d.verify).not.toHaveBeenCalled(); expect(d.restart).not.toHaveBeenCalled();
});
it('verifies and rearms before the approved restart', async () => {
 const d=fixture(); await reconnectSharedDesktop('config', 'ws://local', true, d);
 expect(d.verify).toHaveBeenCalledWith('config','ws://local');
 expect(d.verify.mock.invocationCallOrder[0]).toBeLessThan(d.restart.mock.invocationCallOrder[0]);
});
it('does not restart after a failed compatibility check', async () => {
 const d=fixture(); d.verify.mockRejectedValue(new Error('unsupported'));
 await expect(reconnectSharedDesktop('config', 'ws://local', true, d)).rejects.toThrow('unsupported'); expect(d.restart).not.toHaveBeenCalled();
});
it('leaves a Desktop that opened during verification untouched without approval', async () => {
 const d=fixture(); d.running.mockReturnValueOnce(false).mockReturnValue(true);
 await expect(reconnectSharedDesktop('config','ws://local',false,d)).rejects.toThrow('opened during'); expect(d.restart).not.toHaveBeenCalled();
});
it('can recover a closed Desktop without interrupting any process', async () => {
 const d=fixture(); d.running.mockReturnValue(false);
 await reconnectSharedDesktop('config','ws://local',false,d); expect(d.restart).toHaveBeenCalledOnce();
});
