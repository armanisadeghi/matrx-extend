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

import { InteractionAskCard } from './InteractionAskCard';
import type { ToolDisplayEntry } from './types';

export const toolDisplayRegistry: Record<string, ToolDisplayEntry> = {
  // Server-side multi-question questionnaire tool. The args carry the spec
  // (introduction + array of {id, prompt, component_type, options?}); without
  // a custom component the user just sees an opaque "Done" row and can never
  // actually answer. The card renders inputs + a submit button that posts the
  // answers back as a normal user chat message.
  interaction_ask: {
    CustomComponent: InteractionAskCard,
  },


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
      // Per-category icon: the category arg goes through `browserCategoryIcon`
      // which maps "core" → "Wrench", "forms" → "FormInput", etc. Started
      // phase keeps a Loader2 spinner so progress is obvious.
      icon: {
        started: 'Loader2',
        completed: { path: 'args.category', transform: 'browserCategoryIcon' },
        error: 'AlertTriangle',
      },
      prefix: {
        started: 'Loading my',
        completed: 'Loaded my',
        error: 'Failed to load my',
      },
      name: { path: 'args.category' },
      suffix: 'browser tools',
      color: { started: 'primary', completed: 'amber', error: 'red' },
    },
    args: { hidden: true },
    results: {
      displayType: 'custom',
      keysInfo: [{ key: 'tools_loaded', component: 'Chips' }],
    },
  },

  get_active_tab: {
    inline: {
      // Favicon as the icon: the URL flows from args/output via InfoSpec; the
      // renderer detects the http(s) prefix and renders an <img> instead of a
      // lucide component, falling back to Globe if the favicon 404s.
      icon: {
        started: 'Loader2',
        completed: { path: 'output.fav_icon_url', fallback: 'Globe' },
        error: 'AlertTriangle',
      },
      prefix: {
        started: 'Reading active tab',
        error: "Couldn't read active tab",
      },
      name: {
        started: '',
        completed: { path: 'output.title', transform: 'truncate80' },
        error: '',
      },
      info: { completed: { path: 'output.url', transform: 'truncate80' } },
      color: { started: 'primary', completed: 'blue', error: 'red' },
    },
    args: { hidden: true },
    // Favicon + title + URL already in the inline row — no extra body needed.
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
    args: { hidden: true },
    results: {
      displayType: 'custom',
      // Empty key = pass the whole result object; Base64Image assembles the data URI
      // from `image_base64` + `media_type` and shows a small dimensions/size caption.
      keysInfo: [{ key: '', component: 'Base64Image' }],
      // The whole point of take_screenshot IS the image — show it directly,
      // no click required.
      alwaysShow: true,
    },
  },

  read_page: {
    inline: {
      icon: { started: 'Loader2', completed: 'BookOpenText', error: 'AlertTriangle' },
      prefix: {
        started: 'Reading page',
        completed: 'Read page',
        error: 'Failed to read page',
      },
      name: '',
      info: { completed: { path: 'output.count', fallback: '' } },
      suffix: { completed: 'elements' },
      color: { started: 'primary', completed: 'sky', error: 'red' },
    },
    args: { hidden: true },
    // The result is huge (full a11y tree). Default JSON in the expanded view is fine.
  },

  click_element: {
    inline: {
      // MousePointerClick across all phases gives a consistent "clicking" identity;
      // the label shimmer + spin override on started signals "in progress".
      icon: 'MousePointerClick',
      prefix: {
        started: 'Clicking',
        completed: 'Clicked',
        error: 'Failed to click',
      },
      name: '',
      info: { path: 'args.ref' },
      color: { started: 'primary', completed: 'emerald', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },

  find: {
    inline: {
      // Search icon is the obvious metaphor; on started the label shimmers and
      // the icon spins — together they signal "actively scanning the page".
      icon: 'Search',
      prefix: {
        started: 'Searching for',
        completed: 'Found',
        error: 'Search failed',
      },
      // The natural-language query takes over the label so the user sees what's
      // being looked for in real time.
      name: { path: 'args.query', transform: 'truncate80' },
      // After completion: append the count of matches.
      info: { completed: { path: 'output.matches.length', fallback: '0' } },
      suffix: { completed: 'matches' },
      color: { started: 'primary', completed: 'violet', error: 'red' },
    },
    args: { displayType: 'key-value' },
  },
};
