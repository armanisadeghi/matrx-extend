// NOTE: we deliberately do NOT `/// <reference types="vite/client" />`.
// Two reasons:
//   1. Under pnpm, `vite` is a transitive dep of wxt and is not hoisted to
//      `node_modules/vite`, so the reference silently resolved to nothing.
//   2. vite/client declares `interface ImportMetaEnv { [key: string]: any }`.
//      That index signature would merge into ours and make every typo'd
//      `import.meta.env.WXT_*` read an `any` instead of a compile error —
//      the exact failure mode the env-var rules in CLAUDE.md exist to prevent.
// The only thing we actually needed from it was the asset module shapes,
// declared explicitly below.

// CSS is bundled by Vite for its side effects and has no JS shape. Declared as
// an empty module (not shorthand) so a value import of it is still an error.
declare module '*.css' {}

interface ImportMetaEnv {
  readonly WXT_SUPABASE_URL: string;
  readonly WXT_SUPABASE_PUBLISHABLE_KEY: string;
  readonly WXT_EXTENSION_OAUTH_CLIENT_ID?: string;
  readonly WXT_DESKTOP_LOCAL_URL?: string;
  readonly WXT_DESKTOP_NATIVE_HOST?: string;
  readonly WXT_FRONTEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  type Plugin = (service: TurndownService) => void;
  export const gfm: Plugin;
  export const tables: Plugin;
  export const taskListItems: Plugin;
  export const strikethrough: Plugin;
  export const highlightedCodeBlock: Plugin;
  const _default: { gfm: Plugin };
  export default _default;
}
