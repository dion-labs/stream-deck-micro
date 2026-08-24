import { createCanvas } from '@napi-rs/canvas';
import type { AgentSlotSnapshot } from '../core/types.js';
import { ATTENTION_COLORS, attentionColor, stateColor } from './layout.js';

/**
 * Renders one key icon to a raw RGBA buffer (elgato-stream-deck handles the
 * device-specific encoding). Pure function of its inputs.
 */
export function renderSlotKey(
  snapshot: AgentSlotSnapshot,
  selected: boolean,
  iconSize = 72,
  pulsePhase = 0,
  attentionState?: 'done' | 'error',
): Buffer {
  const canvas = createCanvas(iconSize, iconSize);
  const ctx = canvas.getContext('2d');
  const [r, g, b] = attentionState
    ? attentionColor(pulsePhase)
    : stateColor(snapshot.state, pulsePhase);
  const brightAttention = Boolean(attentionState && pulsePhase);
  const textColor = brightAttention
    ? `rgb(${ATTENTION_COLORS.ink.join(',')})`
    : '#ffffff';
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, iconSize, iconSize);

  // state caption
  ctx.fillStyle = textColor;
  ctx.globalAlpha = 0.85;
  ctx.font = `bold ${attentionState ? 9 : 11}px sans-serif`;
  ctx.textAlign = 'center';
  const caption = attentionState
    ? `${attentionState.toUpperCase()} · OPEN`
    : snapshot.detail === 'session attached'
      ? 'ATTACHED'
    : snapshot.state === 'empty'
      ? 'empty'
      : snapshot.state === 'thinking'
        ? 'THINKING'
        : snapshot.state === 'running'
          ? 'WORKING'
          : snapshot.state === 'done'
            ? 'DONE'
            : snapshot.state === 'error'
              ? 'ERROR'
              : 'idle';
  ctx.fillText(caption, iconSize / 2, iconSize - 7);
  ctx.globalAlpha = 1;

  // slot number, always visible
  ctx.fillStyle = textColor;
  ctx.globalAlpha = 0.6;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(String(snapshot.index + 1), 5, 13);
  ctx.globalAlpha = 1;

  // label (first-prompt / thread name), up to two lines
  if (snapshot.state !== 'empty' && snapshot.label) {
    ctx.fillStyle = textColor;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    const lines = wrap(snapshot.label, 12, 2);
    lines.forEach((line, i) => {
      ctx.fillText(line, iconSize / 2, 30 + i * 14);
    });
  }

  if (selected) {
    ctx.strokeStyle = brightAttention ? `rgb(${ATTENTION_COLORS.ink.join(',')})` : '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, iconSize - 3, iconSize - 3);
  }

  const data = ctx.getImageData(0, 0, iconSize, iconSize);
  return Buffer.from(data.data.buffer, 0, data.data.byteLength);
}

export function renderActionKey(
  title: string,
  color: [number, number, number],
  subtitle?: string,
  iconSize = 72,
): Buffer {
  const canvas = createCanvas(iconSize, iconSize);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
  ctx.fillRect(0, 0, iconSize, iconSize);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(title, iconSize / 2, subtitle ? iconSize / 2 : iconSize / 2 + 6);
  if (subtitle) {
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(subtitle, iconSize / 2, iconSize / 2 + 18);
  }
  const data = ctx.getImageData(0, 0, iconSize, iconSize);
  return Buffer.from(data.data.buffer, 0, data.data.byteLength);
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines - 1 && candidate.length > maxChars) break;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, maxChars - 1)}…`;
  }
  return lines;
}
