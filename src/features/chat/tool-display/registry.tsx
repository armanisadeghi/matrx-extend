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
};
