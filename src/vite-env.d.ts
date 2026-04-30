/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly WXT_SUPABASE_URL: string;
  readonly WXT_SUPABASE_PUBLISHABLE_KEY: string;
  readonly WXT_EXTENSION_OAUTH_CLIENT_ID?: string;
  readonly WXT_DEFAULT_BACKEND?: 'prod' | 'staging' | 'dev' | 'local';
  readonly WXT_BACKEND_URL?: string;
  readonly WXT_DESKTOP_LOCAL_URL?: string;
  readonly WXT_DESKTOP_NATIVE_HOST?: string;
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
