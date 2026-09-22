"""Verify a built native ZIP using disposable extraction and synthetic loopback HTTP only."""
import hashlib, json, os, plistlib, re, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text())['version']
build_match=re.search(r'<key>CFBundleVersion</key><string>([0-9]+)</string>', (root/'scripts/package-native.mjs').read_text())
assert build_match, 'Missing native build number'
expected_build=build_match.group(1)
archive=root/f'release/Codex-Stream-Deck-{version}-macOS-arm64.zip'
expected=(root/'release/SHA256SUMS').read_text().split()[0]
assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected
with tempfile.TemporaryDirectory(prefix='sdm-artifact-', dir='/tmp') as scratch:
 subprocess.run(['/usr/bin/ditto','-x','-k',str(archive),scratch],check=True)
 bundle=Path(scratch)/'Codex + Stream Deck.app'
 subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(bundle)],check=True)
 info=plistlib.loads((bundle/'Contents/Info.plist').read_bytes())
 assert info['CFBundleShortVersionString']==version and info['CFBundleVersion']==expected_build
 runtime=bundle/'Contents/Resources/runtime'
 assert json.loads((runtime/'package.json').read_text())['version']==version
 assert (bundle/'Contents/Resources/Micro.streamDeckPlugin').stat().st_size>1000
 smoke=Path(scratch)/'smoke.mjs'
 smoke.write_text(r'''
import assert from 'node:assert/strict';
import fs, { readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { connect, createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const runtime = process.argv[2];
const config = await import(pathToFileURL(runtime + '/dist/config.js'));
const fixture = join(process.env.TMPDIR, 'config-fixture.json');
const original = '{invalid fixture';
const writers = [
 () => config.saveWorkflows(fixture, [], []),
 () => config.saveDeckSettings(fixture, config.DEFAULT_DECK_SETTINGS),
 () => config.saveDeckLayout(fixture, []),
 () => config.saveAppServerUrl(fixture, 'ws://127.0.0.1:17532'),
 () => config.saveSurfaceMode(fixture, 'marketplace'),
];
for (const write of writers) {
 writeFileSync(fixture, original);
 assert.throws(write, /invalid config/);
 assert.equal(readFileSync(fixture, 'utf8'), original);
}
console.log('Extracted bundled runtime: invalid config preservation passed');
const realWrite = fs.writeFileSync;
try {
 fs.writeFileSync = (file, ...args) => {
   if (typeof file === 'number') {
     realWrite(file, 'partial');
     throw new Error('fixture disk full');
   }
   return realWrite(file, ...args);
 };
 syncBuiltinESMExports();
 for (const write of writers) {
   const valid = JSON.stringify({ fixture: 'preserve original bytes' });
   realWrite(fixture, valid);
   assert.throws(write, /fixture disk full/);
   assert.equal(readFileSync(fixture, 'utf8'), valid);
 }
 assert.equal(fs.readdirSync(process.env.TMPDIR).filter(name => name.startsWith('.sdm-config-')).length, 0);
 console.log('Extracted bundled runtime: all five writers preserve valid config on partial write failure');
} finally {
 fs.writeFileSync = realWrite;
 syncBuiltinESMExports();
}
const {serveIpc, ipcCall} = await import(pathToFileURL(runtime + '/dist/ipc.js'));
const ipcPath = join(process.env.TMPDIR, 'i.sock');
await serveIpc(ipcPath, (_cmd, args) => args);
const unicode = 'caffè 👩‍💻 漢字';
const request = Buffer.from(JSON.stringify({id:1,cmd:'echo',args:{text:unicode}}) + '\n');
const requestSplit = request.indexOf(Buffer.from('è')) + 1;
const echoed = await new Promise((resolve, reject) => {
 const socket = connect(ipcPath);
 socket.setEncoding('utf8');
 const deadline = setTimeout(() => { socket.destroy(); reject(new Error('fixture IPC deadline')); }, 1000);
 let result = '';
 socket.on('error', reject);
 socket.on('close', () => clearTimeout(deadline));
 socket.on('connect', () => {
   socket.write(request.subarray(0, requestSplit));
   setTimeout(() => socket.write(request.subarray(requestSplit)), 20);
 });
 socket.on('data', part => {
   result += part;
   if (result.includes('\n')) { resolve(JSON.parse(result.split('\n')[0])); socket.destroy(); }
 });
});
assert.deepEqual(echoed.data, {text:unicode});
const peerPath = join(process.env.TMPDIR, 'p.sock');
let peerCalls = 0;
const peer = createNetServer(socket => socket.once('data', () => {
 if (++peerCalls > 1) { socket.end(); return; }
 const response = Buffer.from(JSON.stringify({ok:true,data:{text:unicode}}) + '\n');
 const split = response.indexOf(Buffer.from('è')) + 1;
 socket.write(response.subarray(0,split));
 setTimeout(() => socket.end(response.subarray(split)), 20);
}));
await new Promise((resolve,reject) => { peer.once('error',reject); peer.listen(peerPath,resolve); });
try {
 assert.deepEqual(await ipcCall(peerPath,'fixture',{},1000), {text:unicode});
 await assert.rejects(ipcCall(peerPath,'fixture',{},1000), /disconnected/);
} finally { await new Promise(resolve => peer.close(resolve)); }
console.log('Extracted bundled runtime: fragmented UTF-8 in both directions and early EOF passed');
const {validateCommandIndices} = await import(pathToFileURL(runtime + '/dist/core/commandIndices.js'));
for (const [cmd, field] of [['select','index'],['clear','index'],['rename','index'],['attach','slotIndex'],['slots.swap','firstIndex'],['slots.swap','secondIndex'],['desktop.open','index'],['deck.key','index']]) {
 assert.throws(() => validateCommandIndices(cmd,{firstIndex:0,secondIndex:1,[field]:null},15), /must be an integer/);
}
assert.equal(config.APP_DIR, join(process.env.TMPDIR, '.stream-deck-micro'));
const cliRequests = [];
await serveIpc(config.IPC_SOCKET, (cmd, args) => {
 cliRequests.push({cmd,args});
 return {selectedIndex:args.index,cleared:args.index,renamed:args.index};
});
async function cli(args) {
 return new Promise((resolve,reject) => {
  const child = spawn(process.execPath,[join(runtime,'dist/cli/sdm.js'),...args],{
   env:{PATH:'/usr/bin:/bin',HOME:process.env.TMPDIR,TMPDIR:process.env.TMPDIR},stdio:['ignore','pipe','pipe']
  });
  let stdout='',stderr='';
  const deadline=setTimeout(() => {child.kill('SIGKILL');reject(new Error('fixture CLI deadline'));},3000);
  child.stdout.on('data',part => {stdout+=part;});
  child.stderr.on('data',part => {stderr+=part;});
  child.on('error',error => {clearTimeout(deadline);reject(error);});
  child.on('close',code => {clearTimeout(deadline);resolve({code,stdout,stderr});});
 });
}
for (const cmd of ['select','clear','rename']) {
 const result=await cli([cmd,'bad',...(cmd==='rename'?['Fixture']:[])]);
 assert.equal(result.code,1);
 assert.match(result.stderr,/slot must be/);
}
assert.equal(cliRequests.length,0);
const selected=await cli(['select','15']);
assert.equal(selected.code,0);
assert.match(selected.stdout,/selected slot 15/);
assert.deepEqual(cliRequests,[{cmd:'select',args:{index:14}}]);
console.log('Extracted bundled CLI: invalid slots never dispatched; slot 15 maps to index 14; shared null guards passed');

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
