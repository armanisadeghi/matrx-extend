/**
 * The tool-display registry. Map a tool name (the raw `toolName` string —
 * e.g. `ctx_get`, `read_page`) to a `ToolDisplayEntry` and the chat surfaces
 * (`ToolTimelineRow` for client tools, `ServerToolRow` for server tools)
 * will route through `ConfigurableToolRow` instead of their generic default.
 *
 * Anything not registered keeps rendering exactly as it does today.
 *
 * Adding a new entry:
 *   1. Add a key here. The minimum useful shape is `{ inline: { ... } }`.
 *   2. For phase-aware text/icons/colors, pass an object keyed by phase:
 *      `prefix: { started: 'Getting', completed: 'Got', error: 'Failed to get' }`.
 *   3. For result rendering, pick a `displayType`. `'custom'` lets you map
 *      individual result keys to field components (see `keysInfo` below).
 *
 * Field components live in `./registry-components.tsx`.
 * Transforms live in `./registry-transforms.ts`.
 */

import type { ToolDisplayEntry } from './types';

export const toolDisplayRegistry: Record<string, ToolDisplayEntry> = {
  ctx_get: {
    inline: {
      icon: { started: 'Loader2', completed: 'HandGrab', error: 'AlertTriangle' },
      prefix: { started: 'Getting', completed: 'Got', error: 'Failed to get' },
      name: '',
      info: {
        path: 'args.key',
        transform: 'snakeToTitle',
      },
      color: { started: 'primary', completed: 'blue', error: 'red' },
    },
    args: { displayType: 'key-value' },
    results: {
      displayType: 'custom',
      keysInfo: [
        { key: 'label', component: 'BoldLabel', className: 'text-foreground' },
        {
          key: 'content',
          component: 'Markdown',
          className: 'text-foreground',
          transform: 'textClean',
        },
      ],
    },
  },

  load_browser_tools: {
    inline: {
      icon: { started: 'Loader2', completed: 'Boxes', error: 'AlertTriangle' },
      prefix: {
        started: 'Loading my',
        completed: 'Loaded my',
        error: 'Failed to load my',
      },
      // Pull the category out of args so it appears mid-sentence.
      name: { path: 'args.category' },
      suffix: 'browser tools',
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { hidden: true }, // Already conveyed by the header.
    results: {
      displayType: 'custom',
      keysInfo: [{ key: 'tools_loaded', component: 'Chips' }],
    },
  },

  get_active_tab: {
    inline: {
      icon: { started: 'Loader2', completed: 'Globe', error: 'AlertTriangle' },
      prefix: {
        started: 'Reading active tab',
        error: "Couldn't read active tab",
      },
      // Page title takes over the header on success; suppress on the other phases.
      name: {
        started: '',
        completed: { path: 'output.title', transform: 'truncate80' },
        error: '',
      },
      color: { started: 'primary', completed: 'blue', error: 'red' },
    },
    args: { hidden: true },
    results: {
      displayType: 'custom',
      keysInfo: [{ key: '', component: 'TabCard' }],
    },
  },

  take_screenshot: {
    inline: {
      icon: { started: 'Loader2', completed: 'Camera', error: 'AlertTriangle' },
      prefix: {
        started: 'Capturing screenshot',
        completed: 'Captured screenshot',
        error: 'Failed to capture screenshot',
      },
      name: '',
      info: {
        completed: { path: 'output', transform: 'formatImageDimensions' },
      },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
    results: {
      displayType: 'custom',
      // Empty key = pass the whole result object; Base64Image assembles the data URI
      // from `image_base64` + `media_type` and shows a small dimensions/size caption.
      keysInfo: [{ key: '', component: 'Base64Image' }],
    },
  },
};
