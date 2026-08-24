import type { DaemonStatus, SurfaceAction } from './types.js';

const STATE_COLORS = {
  empty: ['#191A20', '#202128'],
  idle: ['#30343A', '#41464D'],
  thinking: ['#4F248E', '#7C3AED'],
  running: ['#173F91', '#2563EB'],
  done: ['#0C6B31', '#16A34A'],
  error: ['#8B1720', '#DC2626'],
} as const;

export function renderKey(
  status: DaemonStatus | null,
  keyIndex: number,
  pulse: boolean,
  error?: string,
): string {
  if (!status) {
    return keyIndex === 7
      ? tile('#2B164D', '#7C3AED', 'BRIDGE', 'START', false, true)
      : blank('#08070B');
  }
  if (status.surface !== 'marketplace') {
    return keyIndex === 7
      ? tile('#571B23', '#DC2626', 'SWITCH', 'MODE', false, true)
      : blank('#0B0708');
  }
  if (status.deck.desktopRecovery) {
    if (keyIndex !== 7) return blank('#000000');
    const restarting = status.deck.desktopRecovery === 'restarting';
    return tile(
      restarting ? '#293142' : '#6A3B0A',
      restarting ? '#4A5A73' : '#B46C14',
      restarting ? 'OPENING' : 'RESTART',
      'CODEX',
      false,
      !restarting,
    );
  }
  if (status.deck.mode === 'asleep') return blank('#000000');

  const mapping = status.deck.layout.find((entry) => entry.keyIndex === keyIndex)?.action;
  if (!mapping) return blank('#090A0D');

  if (status.deck.mode === 'attention') {
    if (mapping.kind !== 'slot') return blank('#000000');
    const attention = status.deck.attention.find((entry) => entry.index === mapping.index);
    if (!attention) return blank('#000000');
  }

  return renderAction(status, mapping, pulse, error);
}

/** Stream Deck expects generated SVG feedback as an encoded image data URL. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function renderAction(
  status: DaemonStatus,
  action: SurfaceAction,
  pulse: boolean,
  _error?: string,
): string {
  if (action.kind === 'slot') {
    const slot = status.slots[action.index];
    if (!slot) return blank('#090A0D');
    const attention = status.deck.attention.some((entry) => entry.index === action.index);
    const colors = STATE_COLORS[slot.state];
    const lively = slot.state === 'thinking' || slot.state === 'running' || attention;
    const end = lively && !pulse ? colors[0] : colors[1];
    const title = slot.state === 'empty' ? `AG${action.index + 1}` : compact(slot.label, 12);
    const footer = attention
      ? 'ATTENTION'
      : slot.detail === 'session attached'
        ? 'ATTACHED'
        : stateLabel(slot.state);
    return tile(colors[0], end, title, footer, action.index === status.selectedIndex, attention);
  }

  if (action.kind === 'stop') return tile('#67151C', '#DC2626', 'STOP', 'TURN');
  if (action.kind === 'attach') return tile('#6A3B0A', '#B46C14', 'ATCH', 'LATEST');
  if (action.kind === 'sleep') {
    if (status.deck.settings.sleepKey === 'toggle-auto') {
      return tile(
        '#252A36',
        status.deck.settings.autoSleep.enabled ? '#315845' : '#373A42',
        'AUTO',
        status.deck.settings.autoSleep.enabled ? 'ON' : 'OFF',
      );
    }
    return tile('#202631', '#374155', 'SLEEP', 'NOW');
  }

  const workflow = status.workflows.find((entry) => entry.id === action.id);
  const doIt = action.id === 'do-it';
  return tile(
    doIt ? '#0B552E' : '#292F66',
    doIt ? '#167847' : '#414B91',
    compact(doIt ? 'DO IT' : (workflow?.name ?? action.id), 10),
    doIt ? 'PROMPT' : compact(action.id, 11),
  );
}

function tile(
  start: string,
  end: string,
  title: string,
  footer: string,
  selected = false,
  attention = false,
): string {
  const [line1, line2] = splitTitle(title);
  const titleY = line2 ? 61 : 70;
  const border = selected ? '#F6F4FF' : attention ? '#D8FFE5' : 'rgba(255,255,255,.13)';
  const borderWidth = selected ? 5 : attention ? 4 : 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    <linearGradient id="g" x1="18" y1="10" x2="126" y2="136" gradientUnits="userSpaceOnUse">
      <stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/>
    </linearGradient>
    <radialGradient id="l" cx="0" cy="0" r="1" gradientTransform="translate(104 18) rotate(120) scale(98)">
      <stop stop-color="white" stop-opacity=".17"/><stop offset="1" stop-color="white" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="144" height="144" rx="24" fill="#07080B"/>
  <rect x="5" y="5" width="134" height="134" rx="21" fill="url(#g)" stroke="${border}" stroke-width="${borderWidth}"/>
  <rect x="5" y="5" width="134" height="134" rx="21" fill="url(#l)"/>
  <circle cx="21" cy="22" r="3" fill="white" fill-opacity=".54"/>
  <text x="72" y="${titleY}" text-anchor="middle" fill="#FFF" font-family="-apple-system,BlinkMacSystemFont,Inter,Arial,sans-serif" font-size="${line2 ? 22 : 25}" font-weight="760" letter-spacing=".6">${escapeXml(line1)}</text>
  ${line2 ? `<text x="72" y="87" text-anchor="middle" fill="#FFF" font-family="-apple-system,BlinkMacSystemFont,Inter,Arial,sans-serif" font-size="22" font-weight="760" letter-spacing=".6">${escapeXml(line2)}</text>` : ''}
  <text x="72" y="119" text-anchor="middle" fill="#FFF" fill-opacity=".7" font-family="-apple-system,BlinkMacSystemFont,Inter,Arial,sans-serif" font-size="10" font-weight="700" letter-spacing="1.5">${escapeXml(footer.toUpperCase())}</text>
</svg>`;
}

function blank(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="${color}"/></svg>`;
}

function stateLabel(state: DaemonStatus['slots'][number]['state']): string {
  if (state === 'thinking') return 'THINKING';
  if (state === 'running') return 'WORKING';
  if (state === 'done') return 'COMPLETE';
  return state.toUpperCase();
}

function compact(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function splitTitle(value: string): [string, string?] {
  const upper = value.toUpperCase();
  if (upper.length <= 7 || !upper.includes(' ')) return [upper];
  const words = upper.split(' ');
  if (words.length === 2) return [words[0], words[1]];
  const midpoint = Math.ceil(words.length / 2);
  return [words.slice(0, midpoint).join(' '), words.slice(midpoint).join(' ')];
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char] as string);
}
