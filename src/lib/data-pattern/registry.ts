import { aiExtractMode } from './modes/ai-extract';
import { autoTableMode } from './modes/auto-table';
import { jsonLdMode } from './modes/json-ld';
import { listPatternMode } from './modes/list-pattern';
import { manualCssMode } from './modes/manual-css';
import { microdataMode } from './modes/microdata';
import { networkCaptureMode } from './modes/network-capture';
import { nextDataMode } from './modes/next-data';
import { ogMetaMode } from './modes/og-meta';
import type { ExtractionMode } from './types';

const MODES = new Map<string, ExtractionMode<unknown>>();

function register<T>(mode: ExtractionMode<T>): void {
  MODES.set(mode.id, mode as ExtractionMode<unknown>);
}

register(manualCssMode);
register(jsonLdMode);
register(ogMetaMode);
register(autoTableMode);
register(nextDataMode);
register(aiExtractMode);
register(listPatternMode);
register(microdataMode);
register(networkCaptureMode);

export function getMode(id: string): ExtractionMode<unknown> | null {
  return MODES.get(id) ?? null;
}

export function listModes(): ExtractionMode<unknown>[] {
  return Array.from(MODES.values());
}

export function registerMode<T>(mode: ExtractionMode<T>): void {
  register(mode);
}
