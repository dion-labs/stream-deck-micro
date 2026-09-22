interface IndexField { name: string; optional?: boolean; device?: boolean }

const fields = new Map<string, IndexField[]>([
  ['select', [{ name: 'index' }]],
  ['desktop.open', [{ name: 'index' }]],
  ['clear', [{ name: 'index', optional: true }]],
  ['rename', [{ name: 'index' }]],
  ['slots.swap', [{ name: 'firstIndex' }, { name: 'secondIndex' }]],
  ['attach', [{ name: 'slotIndex', optional: true }]],
  ['deck.key', [{ name: 'index', device: true }]],
]);

/** Reject coercible values before either IPC or HTTP can mutate a slot/key. */
export function validateCommandIndices(
  command: string,
  args: Record<string, unknown>,
  slotCount: number,
  deviceKeyCount = 15,
): void {
  for (const field of fields.get(command) ?? []) {
    const value = args[field.name];
    if (value === undefined && field.optional) continue;
    const limit = field.device ? deviceKeyCount : slotCount;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= limit) {
      throw new Error(`${field.name} must be an integer from 0 to ${limit - 1}`);
    }
  }
}
