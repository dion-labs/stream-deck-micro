#!/usr/bin/env node
import { readSharedInstall } from '../sharedRuntime.js';
import { setupNativeApp } from '../nativeSetup.js';
import { launchDesktop, prepareControlCenter } from '../desktopLauncher.js';
const emit = (state: string, message: string) => console.log(JSON.stringify({ state, message }));
try {
  if (process.argv.includes('--setup')) await setupNativeApp();
  if (!readSharedInstall() && !process.argv.includes('--control-center')) {
    emit('setup-required', 'Move the app to Applications, then choose Set Up Local Bridge. Codex and Elgato Stream Deck must already be installed.');
    process.exit(0);
  }
  const result = process.argv.includes('--control-center')
    ? await prepareControlCenter()
    : await launchDesktop((message) => emit('progress', message));
  emit(result.state, result.message);
} catch (error) {
  emit('error', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
