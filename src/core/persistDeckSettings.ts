import { saveDeckSettings, type Config, type DeckSettings } from '../config.js';

/** Publish only saved state, including commits whose lock cleanup emitted a warning. */
export function persistDeckSettings(
  config: Pick<Config, 'deck'>,
  sourcePath: string | null,
  candidate: DeckSettings,
  publish: (settings: DeckSettings) => void,
): string {
  const path = saveDeckSettings(sourcePath, candidate);
  config.deck = candidate;
  publish(candidate);
  return path;
}
