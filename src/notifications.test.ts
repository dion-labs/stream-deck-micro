import { describe, expect, it } from 'vitest';
import { macNotificationArgs } from './notifications.js';

describe('macNotificationArgs', () => {
  it('passes notification text as argv instead of interpolating AppleScript', () => {
    const args = macNotificationArgs(`Slot 1: D's work`, `quoted "text" and a backslash \\`);
    expect(args[0]).toBe('-e');
    expect(args[1]).toContain('display notification (item 2 of argv)');
    expect(args[2]).toBe('--');
    expect(args[3]).toBe(`Slot 1: D's work`);
    expect(args[4]).toBe(`quoted "text" and a backslash \\`);
    expect(args[1]).not.toContain(`D's work`);
  });

  it('caps title and body lengths', () => {
    const args = macNotificationArgs('t'.repeat(100), 'b'.repeat(300));
    expect(args[3]).toHaveLength(80);
    expect(args[4]).toHaveLength(250);
  });
});
