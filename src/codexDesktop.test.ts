import { describe, expect, it } from 'vitest';
import { codexThreadDeepLink, openCodexThread } from './codexDesktop.js';

describe('Codex Desktop navigation', () => {
  it('builds a thread-specific Codex deep link safely', () => {
    expect(codexThreadDeepLink('thread-123')).toBe('codex://threads/thread-123');
    expect(codexThreadDeepLink(' thread/with spaces ')).toBe(
      'codex://threads/thread%2Fwith%20spaces',
    );
    expect(() => codexThreadDeepLink('   ')).toThrow('thread id is required');
  });

  it('opens ChatGPT with the thread deep link', async () => {
    const calls: { command: string; args: string[] }[] = [];
    await openCodexThread('thread-123', async (command, args) => {
      calls.push({ command, args });
    });

    expect(calls).toEqual([{
      command: '/usr/bin/open',
      args: ['-a', 'ChatGPT', 'codex://threads/thread-123'],
    }]);
  });
});
