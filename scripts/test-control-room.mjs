// Optional isolated browser QA. Set SDM_PLAYWRIGHT_MODULE to an installed
// Playwright module when it is not available in this checkout. Never uses a real profile.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const runtimeRoot = process.env.SDM_RUNTIME_ROOT || fileURLToPath(new URL('../', import.meta.url));
const { startAdminServer } = await import(pathToFileURL(join(runtimeRoot, 'dist/admin/server.js')));
const { layoutActions } = await import(pathToFileURL(join(runtimeRoot, 'dist/deck/layout.js')));
const { chromium } = await import(process.env.SDM_PLAYWRIGHT_MODULE || 'playwright');
const workflows = [{ id: 'do-it', name: 'DO IT', prompt: 'Synthetic fixture only' }];
const status = {
  selectedIndex: 0, harness: 'Codex', surface: 'marketplace', workflows,
  slots: Array.from({ length: 7 }, (_, index) => ({ index, label: `Fixture ${index + 1}`, sessionId: `fixture-${index}`, cwd: '/synthetic', state: 'idle', detail: '', lastMessage: '', updatedAt: Date.now() })),
  capabilities: { mode: 'live', label: 'Live control', reason: 'Synthetic fixture', canNavigateSessions: true, canConfigure: true, canControlSessions: true, canListSessions: true },
  health: { overall: 'ready', components: Object.fromEntries(['bridge', 'surface', 'plugin', 'codexDesktop', 'sharedControl', 'bindings'].map(name => [name, { state: 'ready', message: 'Fixture' }])) },
  desktop: { state: 'connected', sessionsReady: true },
  deck: { mode: 'awake', settings: { brightness: 70, autoSleep: { enabled: true, timeoutMinutes: 15 }, sleepKey: 'sleep' }, layout: [...layoutActions(workflows)].map(([keyIndex, action]) => ({ keyIndex, action })), attention: [], autoSleepDueAt: null },
};
const mutations = [];
const server = await startAdminServer(0, async (cmd, args) => {
  if (cmd === 'status') return status;
  if (cmd === 'sessions') return status.slots.map(slot => ({ id: slot.sessionId, name: slot.label, cwd: slot.cwd }));
  if (cmd === 'workflows.get') return { active: workflows, library: [] };
  mutations.push({ cmd, args });
  throw new Error('Synthetic action failure');
});
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.url);
  await page.locator('[data-key-index]').first().waitFor();
  assert.equal(await page.locator('[data-key-index]').count(), 15);
  assert.match(await page.locator('.deck').getAttribute('class'), /configuring/);
  const stopKey = page.locator('[data-key-index="7"]');
  assert.equal(await stopKey.evaluate(key => key.tagName), 'BUTTON', 'Deck keys need native keyboard semantics');
  await page.locator('[data-key-index="6"]').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.keyIndex), '7', 'Tab must reach STOP');
  const previousKey = await stopKey.elementHandle();
  await page.waitForResponse(response => response.url().endsWith('/api/status'));
  await page.waitForFunction(key => !key.isConnected, previousKey);
  assert.equal(await stopKey.evaluate(key => getComputedStyle(key).outlineStyle), 'solid');
  if (process.env.SDM_BROWSER_EVIDENCE_DIR) {
    mkdirSync(process.env.SDM_BROWSER_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.SDM_BROWSER_EVIDENCE_DIR, 'deck-product-desktop.png'), fullPage: true });
  }
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.keyIndex), '7', 'Polling must preserve key focus');
  await stopKey.press('Enter');
  assert.equal(mutations.length, 0, 'Configure click must not execute STOP');
  await page.getByRole('button', { name: 'Live control', exact: true }).click();
  const heldStop = page.locator('[data-key-index="7"]');
  await heldStop.focus();
  const heldNode = await heldStop.elementHandle();
  await page.keyboard.down('Space');
  await page.waitForResponse(response => response.url().endsWith('/api/status'));
  await page.waitForTimeout(100);
  assert.equal(await heldNode.evaluate(key => key.isConnected), true, 'Polling must retain a pressed native button');
  await page.keyboard.up('Space');
  await page.getByText('Synthetic action failure', { exact: true }).waitFor();
  assert.deepEqual(mutations.map(value => value.cmd), ['stop']);
  await page.locator('[data-key-index="7"]').focus();
  await page.keyboard.down('Space');
  await page.waitForResponse(response => response.url().endsWith('/api/status'));
  await page.getByRole('button', { name: 'Configure', exact: true }).focus();
  await page.keyboard.up('Space');
  assert.equal(mutations.length, 1, 'Moving focus while held must cancel activation');
  for (const change of ['capability', 'assignment']) {
    await page.reload();
    await page.getByRole('button', { name: 'Live control', exact: true }).click();
    await page.locator('[data-key-index="7"]').focus();
    await page.keyboard.down('Space');
    const originalLayout = structuredClone(status.deck.layout);
    if (change === 'capability') status.capabilities.canControlSessions = false;
    else status.deck.layout.find(entry => entry.keyIndex === 7).action = { kind: 'workflow', id: 'do-it' };
    await page.waitForResponse(response => response.url().endsWith('/api/status'));
    await page.waitForTimeout(100);
    await page.keyboard.up('Space');
    await page.getByText('Key changed while held. Press it again.', { exact: true }).waitFor();
    assert.equal(mutations.length, 1, 'Changed ' + change + ' must cancel held activation');
    status.capabilities.canControlSessions = true;
    status.deck.layout = originalLayout;
  }
  await page.reload();
  await page.locator('.deck.configuring').waitFor();
  assert.equal(mutations.length, 1, 'Reload must disarm without another action');
  status.capabilities = { ...status.capabilities, mode: 'navigation-only', label: 'Navigation only', canControlSessions: false, canListSessions: false };
  await page.reload();
  await page.getByText('Navigation only — Synthetic fixture', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Live control', exact: true }).isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('.deck.configuring').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Narrow page must not overflow horizontally');
  await page.locator('[data-key-index="14"]').scrollIntoViewIfNeeded();
  const lastKey = await page.locator('[data-key-index="14"]').boundingBox();
  assert.ok(lastKey && lastKey.x >= 0 && lastKey.x + lastKey.width <= 390, 'Narrow deck must scroll to the final key');
  if (process.env.SDM_BROWSER_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.SDM_BROWSER_EVIDENCE_DIR, 'deck-product-narrow.png'), fullPage: true });
  status.capabilities.canControlSessions = true;
  status.deck.desktopRecovery = 'verification-required';
  await page.reload();
  await page.getByRole('button', { name: 'Live control', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Verify this Codex Desktop build before restarting shared control.', exact: true });
  await retry.waitFor();
  assert.equal(await page.locator('.deck button:not([disabled])').count(), 2, 'Only actionable recovery keys are enabled');
  await retry.press('Enter');
  await page.getByText('Synthetic action failure', { exact: true }).waitFor();
  assert.deepEqual(mutations.map(value => value.cmd), ['stop', 'desktop.restart']);
  assert.deepEqual(errors, [], 'No browser runtime exceptions');
  console.log('Control Room browser checks passed: 15 named buttons, Tab/Enter/Space, visible focus retained through polling, held Space survives polling; blur/capability/assignment changes cancel, configure safety, armed single STOP/error, reload disarm, navigation-only disable, 390px scroll reach, recovery button gating, no page errors');
} finally {
  await browser?.close();
  await server.close();
}
