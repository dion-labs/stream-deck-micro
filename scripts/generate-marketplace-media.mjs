import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mediaDir = join(root, 'marketplace', 'media');
const sourceDir = join(mediaDir, 'source');
mkdirSync(sourceDir, { recursive: true });

const palette = {
  bg: '#070907',
  panel: '#0d110d',
  panel2: '#131813',
  text: '#f1f3ed',
  muted: '#8d9788',
  quiet: '#5e6859',
  line: '#293027',
  acid: '#c9ff4a',
  violet: '#a78bfa',
  blue: '#60a5fa',
  green: '#4ade80',
  amber: '#fbbf24',
  red: '#fb7185',
  cyan: '#5eead4',
};

const pluginIcon = readFileSync(join(
  root,
  'marketplace/ai.dionlabs.stream-deck-micro.sdPlugin/imgs/plugin/marketplace.png',
)).toString('base64');

function defs() {
  return `
    <defs>
      <radialGradient id="bgGlow" cx="82%" cy="10%" r="90%">
        <stop offset="0" stop-color="#18200f"/>
        <stop offset=".44" stop-color="#0b0e09"/>
        <stop offset="1" stop-color="${palette.bg}"/>
      </radialGradient>
      <linearGradient id="deckBody" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#30352f"/>
        <stop offset=".55" stop-color="#161a16"/>
        <stop offset="1" stop-color="#0b0d0b"/>
      </linearGradient>
      <linearGradient id="keyFace" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#20251f"/>
        <stop offset="1" stop-color="#0b0e0b"/>
      </linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
        <feDropShadow dx="0" dy="26" stdDeviation="24" flood-color="#000" flood-opacity=".65"/>
      </filter>
      <filter id="softGlow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="12"/>
      </filter>
      <pattern id="grid" width="70" height="70" patternUnits="userSpaceOnUse">
        <path d="M70 0H0V70" fill="none" stroke="#fff" stroke-opacity=".027" stroke-width="2"/>
      </pattern>
      <style>
        .sans { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; }
        .mono { font-family: 'SFMono-Regular', Menlo, Monaco, monospace; }
      </style>
    </defs>`;
}

function canvas(content, options = {}) {
  const background = options.light
    ? `<rect width="1920" height="960" fill="#e9ede5"/>`
    : `<rect width="1920" height="960" fill="url(#bgGlow)"/><rect width="1920" height="960" fill="url(#grid)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="960" viewBox="0 0 1920 960">
    ${defs()}
    ${background}
    ${content}
  </svg>`;
}

function eyebrow(text, x = 100, y = 90, color = palette.acid) {
  return `<circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${color}"/>
    <text x="${x + 25}" y="${y}" class="mono" fill="${palette.muted}" font-size="16" font-weight="600" letter-spacing="3">${text}</text>`;
}

function key({ x, y, title, state, color = palette.quiet, index = '', alert = false, w = 122, h = 122 }) {
  const titleSize = title.length > 9 ? 16 : title.length > 6 ? 18 : 22;
  return `<g transform="translate(${x} ${y})">
    <rect x="0" y="7" width="${w}" height="${h}" rx="18" fill="#050605" opacity=".9"/>
    <rect width="${w}" height="${h}" rx="18" fill="url(#keyFace)" stroke="${alert ? '#e5ffd0' : color}" stroke-opacity="${alert ? '.9' : '.38'}" stroke-width="${alert ? 4 : 2}"/>
    <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="15" fill="${color}" fill-opacity=".09"/>
    ${index ? `<text x="14" y="24" class="mono" fill="${color}" font-size="13" font-weight="700">${index}</text>` : ''}
    <text x="${w / 2}" y="${h * .54}" class="sans" text-anchor="middle" fill="${palette.text}" font-size="${titleSize}" font-weight="700" letter-spacing=".6">${title}</text>
    <text x="${w / 2}" y="${h - 18}" class="mono" text-anchor="middle" fill="${color}" font-size="10" font-weight="600" letter-spacing="1.5">${state}</text>
    ${alert ? `<circle cx="${w - 15}" cy="16" r="5" fill="${palette.acid}"/><circle cx="${w - 15}" cy="16" r="12" fill="none" stroke="${palette.acid}" stroke-opacity=".3"/>` : ''}
  </g>`;
}

function deck(x, y, scale = 1, rotate = 0) {
  const keys = [
    ['DIONLABS', 'THINKING', palette.violet, '01', false],
    ['MICRO', 'WORKING', palette.blue, '02', false],
    ['FOLIO', 'COMPLETE', palette.green, '03', false],
    ['VOXTA', 'IDLE', palette.quiet, '04', false],
    ['SIGNALS', 'ATTENTION', palette.amber, '05', true],
    ['CHESSRPG', 'IDLE', palette.quiet, '06', false],
    ['PBOT', 'READY', palette.cyan, '07', false],
    ['STOP', 'TURN', palette.red, '', false],
    ['STATUS', 'PROMPT', palette.blue, '', false],
    ['TESTS', 'PROMPT', palette.violet, '', false],
    ['REVIEW', 'PROMPT', palette.violet, '', false],
    ['DEBUG', 'PROMPT', palette.amber, '', false],
    ['REFACTOR', 'PROMPT', palette.blue, '', false],
    ['SLEEP', 'NOW', '#9aa8bd', '', false],
    ['DO IT', 'PROMPT', palette.acid, '', false],
  ];
  const rendered = keys.map((value, index) => key({
    x: 34 + (index % 5) * 138,
    y: 34 + Math.floor(index / 5) * 138,
    title: value[0],
    state: value[1],
    color: value[2],
    index: value[3],
    alert: value[4],
  })).join('');
  return `<g transform="translate(${x} ${y}) scale(${scale}) rotate(${rotate} 362 225)" filter="url(#shadow)">
    <rect width="746" height="470" rx="44" fill="url(#deckBody)" stroke="#5b6458" stroke-opacity=".6" stroke-width="3"/>
    <rect x="12" y="12" width="722" height="446" rx="35" fill="none" stroke="${palette.acid}" stroke-opacity=".13" stroke-width="2"/>
    ${rendered}
  </g>`;
}

function thumbnail() {
  return canvas(`
    <circle cx="1580" cy="310" r="440" fill="${palette.acid}" fill-opacity=".08"/>
    <circle cx="1580" cy="310" r="290" fill="${palette.acid}" fill-opacity=".05"/>
    <image href="data:image/png;base64,${pluginIcon}" x="100" y="92" width="90" height="90"/>
    <text x="216" y="126" class="mono" fill="${palette.acid}" font-size="15" font-weight="700" letter-spacing="3">DION LABS / OPEN SOURCE</text>
    <text x="216" y="160" class="mono" fill="${palette.quiet}" font-size="13" letter-spacing="2">LOCAL COMMAND CENTER FOR CODEX</text>
    <text x="100" y="345" class="sans" fill="${palette.text}" font-size="105" font-weight="650" letter-spacing="-5">Stream Deck</text>
    <text x="100" y="452" class="sans" fill="${palette.acid}" font-size="105" font-weight="650" letter-spacing="-5">Micro.</text>
    <text x="106" y="525" class="sans" fill="${palette.muted}" font-size="32" font-weight="450">Your agents. One deck.</text>
    <line x1="105" y1="585" x2="690" y2="585" stroke="${palette.line}" stroke-width="2"/>
    <text x="106" y="630" class="mono" fill="#aeb8a9" font-size="16" letter-spacing="1.2">SHARED CODEX SESSIONS</text>
    <text x="106" y="672" class="mono" fill="#aeb8a9" font-size="16" letter-spacing="1.2">LIVE AGENT STATE</text>
    <text x="106" y="714" class="mono" fill="#aeb8a9" font-size="16" letter-spacing="1.2">CUSTOM WORKFLOWS</text>
    <rect x="100" y="785" width="250" height="52" rx="8" fill="${palette.acid}"/>
    <text x="225" y="818" class="mono" text-anchor="middle" fill="#10150a" font-size="14" font-weight="800" letter-spacing="1.7">FREE · MACOS</text>
    ${deck(1040, 225, 1.02, -3)}
  `);
}

function gallerySessions() {
  return canvas(`
    ${eyebrow('01 / LIVE SESSION SURFACE')}
    <text x="100" y="170" class="sans" fill="${palette.text}" font-size="69" font-weight="650" letter-spacing="-3">See what every agent</text>
    <text x="100" y="244" class="sans" fill="${palette.acid}" font-size="69" font-weight="650" letter-spacing="-3">needs from you.</text>
    ${deck(90, 365, .88, 0)}
    <g transform="translate(960 338)">
      <rect width="850" height="500" rx="24" fill="${palette.panel}" stroke="${palette.line}" stroke-width="2"/>
      <text x="52" y="62" class="mono" fill="${palette.quiet}" font-size="14" letter-spacing="2.4">STATE LEGEND / REAL TIME</text>
      ${[
        [palette.violet, 'THINKING', 'A new turn has started'],
        [palette.blue, 'WORKING', 'A tool or command is running'],
        [palette.green, 'COMPLETE', 'The latest turn finished'],
        [palette.amber, 'ATTENTION', 'A session is waiting for you'],
      ].map((row, i) => `<g transform="translate(54 ${112 + i * 84})">
        <rect width="58" height="58" rx="13" fill="${row[0]}" fill-opacity=".15" stroke="${row[0]}" stroke-opacity=".55"/>
        <circle cx="29" cy="29" r="7" fill="${row[0]}"/>
        <text x="84" y="23" class="mono" fill="${palette.text}" font-size="16" font-weight="700" letter-spacing="1.8">${row[1]}</text>
        <text x="84" y="48" class="sans" fill="${palette.muted}" font-size="18">${row[2]}</text>
      </g>`).join('')}
      <text x="54" y="458" class="mono" fill="${palette.acid}" font-size="14" letter-spacing="1.7">PRESS A SESSION TO ACKNOWLEDGE IT →</text>
    </g>
  `);
}

function codexWindow() {
  return `<g transform="translate(100 335)">
    <rect width="1040" height="515" rx="22" fill="#171918" stroke="#343a35" stroke-width="2" filter="url(#shadow)"/>
    <rect width="1040" height="54" rx="22" fill="#222522"/>
    <path d="M0 54h1040" stroke="#343a35"/>
    <circle cx="28" cy="27" r="6" fill="#ff6b67"/><circle cx="48" cy="27" r="6" fill="#f9c64d"/><circle cx="68" cy="27" r="6" fill="#56c77a"/>
    <text x="520" y="33" class="mono" text-anchor="middle" fill="#909890" font-size="12">CODEX DESKTOP · DECK MICRO</text>
    <rect x="0" y="54" width="238" height="461" fill="#111312"/>
    <text x="26" y="94" class="mono" fill="#606861" font-size="11" letter-spacing="1.6">SESSIONS</text>
    <rect x="14" y="112" width="210" height="65" rx="9" fill="#282e26" stroke="${palette.acid}" stroke-opacity=".23"/>
    <circle cx="36" cy="138" r="5" fill="${palette.blue}"/><text x="53" y="141" class="sans" fill="#e9ece7" font-size="14" font-weight="600">deck micro</text><text x="53" y="161" class="mono" fill="#7c867a" font-size="9">working</text>
    <circle cx="36" cy="208" r="5" fill="#566057"/><text x="53" y="212" class="sans" fill="#9aa29a" font-size="14">folioduet</text>
    <circle cx="36" cy="253" r="5" fill="#566057"/><text x="53" y="257" class="sans" fill="#9aa29a" font-size="14">dionlabs</text>
    <g transform="translate(278 94)">
      <text x="0" y="0" class="mono" fill="#737c74" font-size="11" letter-spacing="1.2">SHARED SESSION · 01A02920</text>
      <rect x="0" y="35" width="690" height="102" rx="13" fill="#202420"/>
      <text x="24" y="70" class="mono" fill="#8d978d" font-size="11">YOU</text>
      <text x="24" y="104" class="sans" fill="#eef1ec" font-size="19">lets do it</text>
      <rect x="0" y="160" width="690" height="162" rx="13" fill="#111411" stroke="#283027"/>
      <text x="24" y="196" class="mono" fill="${palette.acid}" font-size="11">CODEX</text>
      <text x="24" y="232" class="sans" fill="#cbd1c9" font-size="17">I’m implementing the agreed layout update now.</text>
      <rect x="24" y="258" width="395" height="39" rx="7" fill="#1d221c"/>
      <circle cx="45" cy="278" r="5" fill="${palette.blue}"/>
      <text x="61" y="282" class="mono" fill="#8e9a8b" font-size="11">npm run check</text>
      <rect x="0" y="348" width="690" height="54" rx="11" fill="#1b1f1b" stroke="#323832"/>
      <text x="22" y="381" class="sans" fill="#737c74" font-size="14">Send a message…</text>
    </g>
  </g>`;
}

function gallerySharedSession() {
  return canvas(`
    ${eyebrow('02 / SHARED SESSION CONTROL')}
    <text x="100" y="170" class="sans" fill="${palette.text}" font-size="69" font-weight="650" letter-spacing="-3">Stay in Codex.</text>
    <text x="100" y="244" class="sans" fill="${palette.acid}" font-size="69" font-weight="650" letter-spacing="-3">Reach from the deck.</text>
    <text x="1010" y="169" class="sans" fill="${palette.muted}" font-size="22">The deck sends prompts into the same session</text>
    <text x="1010" y="204" class="sans" fill="${palette.muted}" font-size="22">that remains open in Codex Desktop.</text>
    ${codexWindow()}
    <g transform="translate(1290 375)">
      <path d="M0 228H120" stroke="${palette.acid}" stroke-width="3" stroke-dasharray="8 9"/><path d="m111 218 14 10-14 10" fill="none" stroke="${palette.acid}" stroke-width="3"/>
      <text x="8" y="207" class="mono" fill="${palette.acid}" font-size="12" letter-spacing="1.3">LOCAL BRIDGE</text>
      ${key({ x: 160, y: 118, title: 'DO IT', state: 'PROMPT', color: palette.acid, w: 190, h: 190 })}
      <text x="255" y="350" class="mono" text-anchor="middle" fill="${palette.text}" font-size="16" font-weight="700" letter-spacing="1.6">ONE PRESS</text>
      <text x="255" y="380" class="sans" text-anchor="middle" fill="${palette.muted}" font-size="18">No session handoff.</text>
      <text x="255" y="407" class="sans" text-anchor="middle" fill="${palette.muted}" font-size="18">No competing owner.</text>
    </g>
  `);
}

function miniControlDeck() {
  const items = [
    ['01', 'DIONLABS', palette.violet], ['02', 'MICRO', palette.blue], ['03', 'FOLIO', palette.green], ['04', 'VOXTA', palette.quiet], ['05', 'SIGNALS', palette.amber],
    ['06', 'CHESS', palette.quiet], ['07', 'PBOT', palette.cyan], ['×', 'STOP', palette.red], ['→', 'STATUS', palette.blue], ['✓', 'TESTS', palette.violet],
    ['R', 'REVIEW', palette.violet], ['D', 'DEBUG', palette.amber], ['RF', 'REFACTOR', palette.blue], ['Z', 'SLEEP', '#9aa8bd'], ['GO', 'DO IT', palette.acid],
  ];
  return items.map((item, i) => {
    const x = (i % 5) * 115;
    const y = Math.floor(i / 5) * 115;
    return `<g transform="translate(${x} ${y})">
      <rect width="101" height="101" rx="12" fill="#131713" stroke="${item[2]}" stroke-opacity=".45" stroke-width="2"/>
      <text x="12" y="23" class="mono" fill="${item[2]}" font-size="11" font-weight="700">${item[0]}</text>
      <text x="50" y="59" class="sans" text-anchor="middle" fill="#e9ede7" font-size="12" font-weight="700">${item[1]}</text>
      <text x="50" y="84" class="mono" text-anchor="middle" fill="#667064" font-size="8">${i < 7 ? 'SESSION' : 'ACTION'}</text>
    </g>`;
  }).join('');
}

function galleryControlRoom() {
  return canvas(`
    <rect width="1920" height="960" fill="#e9ede5"/>
    <rect x="0" y="0" width="620" height="960" fill="#090c09"/>
    ${eyebrow('03 / LOCAL CONTROL ROOM', 90, 90)}
    <text x="90" y="190" class="sans" fill="${palette.text}" font-size="66" font-weight="650" letter-spacing="-3">Configure first.</text>
    <text x="90" y="262" class="sans" fill="${palette.acid}" font-size="66" font-weight="650" letter-spacing="-3">Trigger by choice.</text>
    <text x="90" y="345" class="sans" fill="${palette.muted}" font-size="21">The Control Room opens in Configure mode,</text>
    <text x="90" y="378" class="sans" fill="${palette.muted}" font-size="21">so inspecting a key never launches it by mistake.</text>
    ${[
      ['DRAG TO REORDER', 'Move session contents while slot numbers stay fixed'],
      ['ANY KEY, ANY ROLE', 'Assign a session, workflow, stop, or sleep action'],
      ['RUN MODE', 'Test the browser deck only when you choose to'],
    ].map((row, i) => `<g transform="translate(90 ${470 + i * 112})">
      <circle cx="8" cy="8" r="7" fill="${palette.acid}"/>
      <text x="34" y="14" class="mono" fill="${palette.text}" font-size="14" font-weight="700" letter-spacing="1.4">${row[0]}</text>
      <text x="34" y="46" class="sans" fill="${palette.muted}" font-size="17">${row[1]}</text>
    </g>`).join('')}
    <g transform="translate(680 74)" filter="url(#shadow)">
      <rect width="1150" height="812" rx="24" fill="#f2f4ef" stroke="#cbd1c7" stroke-width="2"/>
      <rect width="1150" height="64" rx="24" fill="#dfe4db"/>
      <path d="M0 64h1150" stroke="#c6ccc2"/>
      <text x="30" y="39" class="mono" fill="#3f5434" font-size="13" font-weight="700">STREAM DECK MICRO / CONTROL ROOM</text>
      <circle cx="890" cy="32" r="5" fill="#77a724"/><text x="905" y="37" class="mono" fill="#65715f" font-size="10">LOCAL · HEALTHY</text>
      <rect x="1014" y="17" width="108" height="30" rx="7" fill="#cfe4a8"/>
      <text x="1068" y="37" class="mono" text-anchor="middle" fill="#365306" font-size="9" font-weight="700">CONFIGURE</text>
      <rect x="0" y="64" width="188" height="748" fill="#e3e7df"/>
      <text x="25" y="108" class="mono" fill="#90988c" font-size="9" letter-spacing="1.5">CONTROL</text>
      ${['Deck layout', 'Sessions', 'Workflows', 'Device', 'Diagnostics'].map((item, i) => `<g transform="translate(16 ${128 + i * 48})">
        <rect width="156" height="38" rx="7" fill="${i === 0 ? '#d0dbc5' : 'transparent'}"/>
        <text x="15" y="24" class="sans" fill="${i === 0 ? '#456414' : '#798276'}" font-size="12" font-weight="${i === 0 ? '650' : '450'}">${item}</text>
      </g>`).join('')}
      <g transform="translate(232 105)">
        <text x="0" y="0" class="mono" fill="#889184" font-size="10" letter-spacing="1.3">PHYSICAL LAYOUT / 5 × 3</text>
        <text x="0" y="38" class="sans" fill="#30382d" font-size="27" font-weight="650">Arrange your surface</text>
        <g transform="translate(0 72)">${miniControlDeck()}</g>
      </g>
      <g transform="translate(840 105)">
        <rect width="268" height="570" rx="14" fill="#e7ebe3" stroke="#ced4ca"/>
        <text x="22" y="38" class="mono" fill="#8c9489" font-size="9" letter-spacing="1.3">KEY INSPECTOR</text>
        <rect x="22" y="61" width="70" height="70" rx="12" fill="#172017" stroke="${palette.violet}" stroke-opacity=".6"/>
        <text x="57" y="88" class="mono" text-anchor="middle" fill="${palette.violet}" font-size="10">02</text>
        <text x="57" y="112" class="sans" text-anchor="middle" fill="#fff" font-size="10" font-weight="700">MICRO</text>
        <text x="110" y="83" class="sans" fill="#374033" font-size="16" font-weight="650">Session slot 2</text>
        <text x="110" y="108" class="mono" fill="#699514" font-size="9">ATTACHED</text>
        <text x="22" y="171" class="mono" fill="#899186" font-size="9">KEY FUNCTION</text>
        <rect x="22" y="188" width="224" height="42" rx="7" fill="#f2f4ef" stroke="#c9cfc5"/>
        <text x="36" y="214" class="sans" fill="#465043" font-size="12">Session slot 2</text>
        <text x="22" y="274" class="mono" fill="#899186" font-size="9">ATTACHED SESSION</text>
        <rect x="22" y="292" width="224" height="93" rx="8" fill="#f2f4ef" stroke="#c9cfc5"/>
        <text x="37" y="323" class="sans" fill="#394235" font-size="13" font-weight="650">deck micro</text>
        <text x="37" y="349" class="mono" fill="#7a8476" font-size="9">01a02920 · shared</text>
        <rect x="22" y="420" width="224" height="42" rx="7" fill="#dbe7cf"/>
        <text x="134" y="446" class="mono" text-anchor="middle" fill="#456414" font-size="9" font-weight="700">BROWSE SESSIONS</text>
      </g>
    </g>
  `, { light: true });
}

function architectureNode(x, y, number, title, detail, color) {
  return `<g transform="translate(${x} ${y})">
    <rect width="430" height="250" rx="22" fill="${palette.panel}" stroke="${color}" stroke-opacity=".38" stroke-width="2"/>
    <rect x="28" y="28" width="50" height="50" rx="11" fill="${color}" fill-opacity=".13" stroke="${color}" stroke-opacity=".48"/>
    <text x="53" y="59" class="mono" text-anchor="middle" fill="${color}" font-size="13" font-weight="700">${number}</text>
    <text x="28" y="134" class="sans" fill="${palette.text}" font-size="28" font-weight="650">${title}</text>
    <text x="28" y="176" class="sans" fill="${palette.muted}" font-size="17">${detail[0]}</text>
    <text x="28" y="205" class="sans" fill="${palette.muted}" font-size="17">${detail[1]}</text>
  </g>`;
}

function galleryLocal() {
  return canvas(`
    ${eyebrow('04 / LOCAL-FIRST ARCHITECTURE')}
    <text x="100" y="180" class="sans" fill="${palette.text}" font-size="72" font-weight="650" letter-spacing="-3">Three local parts.</text>
    <text x="100" y="256" class="sans" fill="${palette.acid}" font-size="72" font-weight="650" letter-spacing="-3">No Dion Labs cloud.</text>
    <text x="1070" y="173" class="sans" fill="${palette.muted}" font-size="21">Your prompts and session contents stay between</text>
    <text x="1070" y="207" class="sans" fill="${palette.muted}" font-size="21">the software already running on your Mac.</text>
    ${architectureNode(100, 405, '01', 'Codex Desktop', ['Keeps session ownership', 'and the full conversation'], palette.violet)}
    ${architectureNode(745, 405, '02', 'Local bridge', ['Coordinates shared state', 'through localhost only'], palette.acid)}
    ${architectureNode(1390, 405, '03', 'Stream Deck', ['Shows live status and', 'sends your chosen actions'], palette.cyan)}
    <path d="M530 530H720" stroke="${palette.acid}" stroke-opacity=".5" stroke-width="3" stroke-dasharray="9 10"/>
    <path d="m704 519 16 11-16 11" fill="none" stroke="${palette.acid}" stroke-width="3"/>
    <path d="M1175 530h190" stroke="${palette.acid}" stroke-opacity=".5" stroke-width="3" stroke-dasharray="9 10"/>
    <path d="m1349 519 16 11-16 11" fill="none" stroke="${palette.acid}" stroke-width="3"/>
    <g transform="translate(100 785)">
      <rect width="1720" height="74" rx="12" fill="#0f140d" stroke="${palette.acid}" stroke-opacity=".18"/>
      <circle cx="36" cy="37" r="7" fill="${palette.green}"/>
      <text x="61" y="43" class="mono" fill="#c1cfb9" font-size="14" letter-spacing="1.6">NO DION LABS ACCOUNT · NO APP TELEMETRY · OPEN SOURCE</text>
      <text x="1678" y="43" class="mono" text-anchor="end" fill="${palette.acid}" font-size="13" letter-spacing="1.5">127.0.0.1</text>
    </g>
  `);
}

const assets = [
  ['thumbnail-1920x960', thumbnail()],
  ['gallery-01-live-sessions', gallerySessions()],
  ['gallery-02-shared-session', gallerySharedSession()],
  ['gallery-03-control-room', galleryControlRoom()],
  ['gallery-04-local-first', galleryLocal()],
];

copyFileSync(
  join(root, 'marketplace/ai.dionlabs.stream-deck-micro.sdPlugin/imgs/plugin/marketplace.png'),
  join(mediaDir, 'icon-288.png'),
);

for (const [name, svg] of assets) {
  const source = join(sourceDir, `${name}.svg`);
  const output = join(mediaDir, `${name}.png`);
  writeFileSync(source, svg);
  execFileSync('/usr/bin/sips', ['-s', 'format', 'png', source, '--out', output], { stdio: 'ignore' });
}

console.log(`Generated ${assets.length + 1} Marketplace media files in ${mediaDir}`);
