"""Verify a built native ZIP using disposable extraction and synthetic loopback HTTP only."""
import hashlib, json, os, plistlib, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text())['version']
archive=root/f'release/Codex-Stream-Deck-{version}-macOS-arm64.zip'
expected=(root/'release/SHA256SUMS').read_text().split()[0]
assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected
with tempfile.TemporaryDirectory(prefix='sdm-artifact-') as scratch:
 subprocess.run(['/usr/bin/ditto','-x','-k',str(archive),scratch],check=True)
 bundle=Path(scratch)/'Codex + Stream Deck.app'
 subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(bundle)],check=True)
 info=plistlib.loads((bundle/'Contents/Info.plist').read_bytes())
 assert info['CFBundleShortVersionString']==version and info['CFBundleVersion'].isdigit()
 runtime=bundle/'Contents/Resources/runtime'
 assert json.loads((runtime/'package.json').read_text())['version']==version
 assert (bundle/'Contents/Resources/Micro.streamDeckPlugin').stat().st_size>1000
 smoke=Path(scratch)/'smoke.mjs'
 smoke.write_text('''
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const runtime = process.argv[2];
const config = await import(pathToFileURL(runtime + '/dist/config.js'));
const fixture = join(process.env.TMPDIR, 'config-fixture.json');
const original = '{invalid fixture';
for (const write of [
 () => config.saveWorkflows(fixture, [], []),
 () => config.saveDeckSettings(fixture, config.DEFAULT_DECK_SETTINGS),
 () => config.saveDeckLayout(fixture, []),
 () => config.saveAppServerUrl(fixture, 'ws://127.0.0.1:17532'),
 () => config.saveSurfaceMode(fixture, 'marketplace'),
]) {
 writeFileSync(fixture, original);
 assert.throws(write, /invalid config/);
 assert.equal(readFileSync(fixture, 'utf8'), original);
}
console.log('Extracted bundled runtime: invalid config preservation passed');
const {startAdminServer, HOSTED_HEALTH_PATH} = await import(pathToFileURL(runtime + '/dist/admin/server.js'));
let calls = 0;
const server = await startAdminServer(0, async () => { calls++; throw new Error('PRIVATE_FIXTURE'); });
try {
 const html = await (await fetch(server.url)).text();
 const token = html.match(/meta name="sdm-api-token" content="([^"]+)"/)[1];
 const headers = {'x-stream-deck-micro-token': token, 'content-type': 'application/json'};
 assert.equal((await fetch(server.url+'/api/stop', {method:'DELETE', headers})).status,405);
 assert.equal((await fetch(server.url+'/api/stop', {method:'POST', headers, body:'null'})).status,400);
 assert.equal(calls,0);
 const response = await fetch(server.url+HOSTED_HEALTH_PATH, {headers:{origin:'https://deck.dionlabs.ai'}});
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'Bridge health is temporarily unavailable.'});
 console.log('Extracted bundled runtime: method/body/privacy regressions passed');
} finally {await server.close();}
''')
 env={'PATH':'/usr/bin:/bin','HOME':scratch,'TMPDIR':scratch}
 subprocess.run([str(runtime/'bin/node'),str(smoke),str(runtime)],check=True,env=env,timeout=30)
 if os.environ.get('SDM_PLAYWRIGHT_MODULE'):
  env['SDM_PLAYWRIGHT_MODULE']=os.environ['SDM_PLAYWRIGHT_MODULE']
  env['SDM_RUNTIME_ROOT']=str(runtime)
  subprocess.run([str(runtime/'bin/node'),str(root/'scripts/test-control-room.mjs')],check=True,env=env,timeout=60)
print('ZIP checksum, extracted strict signature, version/build, plugin, bundled runtime passed:',expected)
