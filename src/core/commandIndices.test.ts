import { describe, expect, it } from 'vitest';
import { validateCommandIndices } from './commandIndices.js';

const cases = [
  ['select', 'index', false, 3],
  ['desktop.open', 'index', false, 3],
  ['clear', 'index', true, 3],
  ['rename', 'index', false, 3],
  ['slots.swap', 'firstIndex', false, 3],
  ['slots.swap', 'secondIndex', false, 3],
  ['attach', 'slotIndex', true, 3],
  ['deck.key', 'index', false, 15],
] as const;

describe.each(cases)('%s.%s command boundary', (command, field, optional, count) => {
  it('rejects coercible and out-of-range input before dispatch', () => {
    for (const value of [null, false, true, '', '0', [], [0], {}, NaN, Infinity, -1, 0.5, count]) {
      const args = { firstIndex: 0, secondIndex: 1, [field]: value };
      expect(() => validateCommandIndices(command, args, 3)).toThrow(/must be an integer/);
    }
  });
  it('accepts exact integer boundaries', () => {
    for (const value of [0, count - 1]) {
      expect(() => validateCommandIndices(command, { firstIndex: 0, secondIndex: 1, [field]: value }, 3)).not.toThrow();
    }
  });
  it('permits omission only for explicitly optional targets', () => {
    const run = () => validateCommandIndices(command, { firstIndex: 0, secondIndex: 1, [field]: undefined }, 3);
    if (optional) expect(run).not.toThrow();
    else expect(run).toThrow(/must be an integer/);
  });
});
it('uses device-key capacity independently from session capacity', () => {
  expect(() => validateCommandIndices('deck.key', { index: 7 }, 3, 8)).not.toThrow();
  expect(() => validateCommandIndices('deck.key', { index: 8 }, 3, 8)).toThrow();
  expect(() => validateCommandIndices('select', { index: 7 }, 3, 8)).toThrow();
});
it('does not change commands without index parameters', () => {
  for (const command of ['status', 'stop', 'send', 'diagnostics', 'constructor', '__proto__']) {
    expect(() => validateCommandIndices(command, {}, 3)).not.toThrow();
  }
});
