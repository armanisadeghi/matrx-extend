import { z } from 'zod';
import type { ExtractionMode } from '../types';

export const networkCaptureConfigSchema = z.object({
  url_filter: z.string(),
  method: z.string().optional(),
  key_path: z.string().optional(),
});
export type NetworkCaptureConfig = z.infer<typeof networkCaptureConfigSchema>;

/**
 * Network Capture is special: re-running a saved pattern of this kind cannot
 * be done in a single chrome.scripting.executeScript pass — you need to
 * replay the page navigation and intercept fetch/XHR. Today the showcase tab
 * orchestrates this interactively by reloading the open tab and listening for
 * matching requests. There is no scheduled network replay runner.
 *
 * This mode entry exists so saved patterns are valid registry entries with
 * recognizable metadata; the runInPage stub returns nothing.
 */
export const networkCaptureMode: ExtractionMode<NetworkCaptureConfig> = {
  id: 'network_capture',
  label: 'Network capture',
  description:
    'Records fetch/XHR responses while the user interacts with the page. Saved patterns rerun interactively on an open page.',
  configSchema: networkCaptureConfigSchema,
  defaultConfig: () => ({ url_filter: '' }),
  detectInPage: () => ({ available: true, summary: 'Always available — interactive only' }),
  runInPage: () => [],
  interactiveOnly: true,
};
