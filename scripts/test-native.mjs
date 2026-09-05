import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'micro-native-tests-'));
try {
  const binary = join(temporary, 'policy-tests');
  execFileSync('/usr/bin/xcrun', ['swiftc', join(root, 'native/ControlCenterPolicy.swift'), join(root, 'native/tests/PolicyTests.swift'), '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
} finally { rmSync(temporary, { recursive: true, force: true }); }
