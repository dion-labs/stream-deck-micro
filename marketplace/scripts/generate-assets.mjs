import { createCanvas } from '@napi-rs/canvas';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const pluginRoot = resolve('ai.dionlabs.stream-deck-micro.sdPlugin');

function png(path, size, draw) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  draw(ctx, size);
  const output = join(pluginRoot, path);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, canvas.toBuffer('image/png'));
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawBrand(ctx, size, transparent = false) {
  if (!transparent) {
    const bg = ctx.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, '#17101F');
    bg.addColorStop(1, '#07120D');
    ctx.fillStyle = bg;
    roundedRect(ctx, 0, 0, size, size, size * 0.18);
    ctx.fill();
  }
  const panel = ctx.createLinearGradient(size * 0.17, size * 0.12, size * 0.84, size * 0.88);
  panel.addColorStop(0, '#8B5CF6');
  panel.addColorStop(1, '#15804B');
  ctx.fillStyle = panel;
  roundedRect(ctx, size * 0.14, size * 0.14, size * 0.72, size * 0.72, size * 0.14);
  ctx.fill();
  const key = size * 0.135;
  const gap = size * 0.045;
  const start = size * 0.23;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      ctx.fillStyle = row === 2 && col === 2 ? '#D7FFE7' : 'rgba(255,255,255,.88)';
      roundedRect(ctx, start + col * (key + gap), start + row * (key + gap), key, key, key * 0.22);
      ctx.fill();
    }
  }
}

for (const [path, size] of [
  ['imgs/plugin/marketplace.png', 288],
  ['imgs/plugin/marketplace@2x.png', 512],
]) png(path, size, (ctx, value) => drawBrand(ctx, value));

for (const [path, size] of [
  ['imgs/plugin/category-icon.png', 28],
  ['imgs/plugin/category-icon@2x.png', 56],
  ['imgs/actions/surface/icon.png', 20],
  ['imgs/actions/surface/icon@2x.png', 40],
]) png(path, size, (ctx, value) => drawBrand(ctx, value, true));

for (const [path, size] of [
  ['imgs/actions/surface/key.png', 72],
  ['imgs/actions/surface/key@2x.png', 144],
]) png(path, size, (ctx, value) => drawBrand(ctx, value));

const actions = {};
for (let row = 0; row < 3; row += 1) {
  for (let column = 0; column < 5; column += 1) {
    actions[`${column},${row}`] = {
      Name: 'Surface Key',
      Settings: null,
      State: 0,
      States: [{
        FFamily: '', FSize: '', FStyle: '', FUnderline: '', Image: '', Title: '',
        TitleAlignment: 'middle', TitleColor: '#FFFFFF', TitleShow: '',
      }],
      UUID: 'ai.dionlabs.stream-deck-micro.surface-key',
    };
  }
}

const profile = {
  Actions: actions,
  DeviceModel: '20GBA9901',
  InstalledByPluginUUID: 'ai.dionlabs.stream-deck-micro',
  Name: 'Stream Deck Micro',
  PreconfiguredName: 'Stream Deck Micro',
  Version: '1.0',
};

const staging = mkdtempSync(join(tmpdir(), 'stream-deck-micro-profile.'));
const profileName = '7B0B36F4-0FA9-4D2B-A64A-D1A2BF7D143B.sdProfile';
const profileDir = join(staging, profileName);
mkdirSync(profileDir, { recursive: true });
writeFileSync(join(profileDir, 'manifest.json'), `${JSON.stringify(profile, null, 2)}\n`);
const output = join(pluginRoot, 'profiles', 'Stream Deck Micro.streamDeckProfile');
mkdirSync(dirname(output), { recursive: true });
rmSync(output, { force: true });
execFileSync('/usr/bin/zip', ['-q', '-r', output, profileName], { cwd: staging });
rmSync(staging, { recursive: true, force: true });
