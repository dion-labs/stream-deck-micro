import { createCanvas } from '@napi-rs/canvas';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
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
    bg.addColorStop(0, '#151816');
    bg.addColorStop(0.56, '#090B09');
    bg.addColorStop(1, '#11180A');
    ctx.fillStyle = bg;
    roundedRect(ctx, 0, 0, size, size, size * 0.22);
    ctx.fill();
  }

  const bodyX = size * 0.1;
  const bodyY = size * 0.2;
  const bodyWidth = size * 0.8;
  const bodyHeight = size * 0.6;
  const rim = ctx.createLinearGradient(bodyX, bodyY, bodyX + bodyWidth, bodyY + bodyHeight);
  rim.addColorStop(0, '#8B5CF6');
  rim.addColorStop(0.52, '#46689A');
  rim.addColorStop(1, '#8FCB22');
  ctx.fillStyle = rim;
  roundedRect(ctx, bodyX, bodyY, bodyWidth, bodyHeight, size * 0.12);
  ctx.fill();

  ctx.fillStyle = '#111511';
  roundedRect(
    ctx,
    bodyX + size * 0.018,
    bodyY + size * 0.018,
    bodyWidth - size * 0.036,
    bodyHeight - size * 0.036,
    size * 0.105,
  );
  ctx.fill();

  const key = size * 0.1;
  const gapX = size * 0.035;
  const gapY = size * 0.04;
  const startX = size * 0.18;
  const startY = size * 0.31;
  const states = [
    '#A78BFA', '#60A5FA', '#4ADE80', '#475047', '#FBBF24',
    '#475047', '#5EEAD4', '#FB7185', '#60A5FA', '#A78BFA',
    '#A78BFA', '#FBBF24', '#60A5FA', '#9AA8BD', '#C9FF4A',
  ];

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const index = row * 5 + col;
      const color = states[index];
      const x = startX + col * (key + gapX);
      const y = startY + row * (key + gapY);
      ctx.fillStyle = color;
      ctx.globalAlpha = index === 14 ? 0.95 : 0.72;
      roundedRect(ctx, x, y, key, key, key * 0.22);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#101410';
      roundedRect(ctx, x + key * 0.12, y + key * 0.12, key * 0.76, key * 0.76, key * 0.15);
      ctx.fill();
    }
  }

  ctx.fillStyle = '#C9FF4A';
  ctx.beginPath();
  ctx.arc(size * 0.835, size * 0.265, size * 0.017, 0, Math.PI * 2);
  ctx.fill();
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
const profileManifest = join(profileDir, 'manifest.json');
writeFileSync(profileManifest, `${JSON.stringify(profile, null, 2)}\n`);
const fixedTimestamp = new Date('2024-01-01T00:00:00.000Z');
utimesSync(profileManifest, fixedTimestamp, fixedTimestamp);
utimesSync(profileDir, fixedTimestamp, fixedTimestamp);
const output = join(pluginRoot, 'profiles', 'Stream Deck Micro.streamDeckProfile');
mkdirSync(dirname(output), { recursive: true });
rmSync(output, { force: true });
execFileSync('/usr/bin/zip', ['-X', '-q', '-r', output, profileName], { cwd: staging });
rmSync(staging, { recursive: true, force: true });
