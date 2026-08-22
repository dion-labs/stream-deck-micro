import { afterEach, describe, expect, it, vi } from 'vitest';
import { printDoctorReport, type DoctorCheck } from './doctor.js';

describe('doctor report', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts a machine-readable report', () => {
    const checks: DoctorCheck[] = [
      { name: 'Node.js', status: 'pass', detail: 'v22.0.0' },
    ];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(() => printDoctorReport(checks, true)).not.toThrow();
    expect(write).toHaveBeenCalledWith(expect.stringContaining('"status": "pass"'));
  });
});
