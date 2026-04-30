import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifest: ({ mode }) => ({
    name: 'Matrx Extend',
    short_name: 'Matrx',
    description:
      'Agentic browser companion — chat, tasks, scraping, structured data extraction, and SEO.',
    // The `key` field locks the extension ID across dev (unpacked) and Web Store.
    // Populate from the Web Store dashboard's "View public key" once first published.
    // key: 'PASTE_BASE64_PUBLIC_KEY_HERE',
    permissions: [
      'storage',
      'sidePanel',
      'activeTab',
      'scripting',
      'identity',
      'offscreen',
      'nativeMessaging',
      'alarms',
      'contextMenus',
      'clipboardWrite',
      'downloads',
      'webNavigation',
    ],
    host_permissions: [
      'https://server.app.matrxserver.com/*',
      'https://staging.server.app.matrxserver.com/*',
      'https://dev.server.app.matrxserver.com/*',
      'http://localhost:8000/*',
      'https://*.aimatrx.com/*',
      'https://txzxabzwovsujtloxrus.supabase.co/*',
      'http://127.0.0.1:*/*',
      '<all_urls>',
    ],
    side_panel: {
      default_path: 'sidepanel.html',
    },
    action: {
      default_title: 'Matrx Extend',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    web_accessible_resources: [
      {
        resources: ['data-picker.css', 'icon/*'],
        matches: ['<all_urls>'],
      },
    ],
    ...(mode === 'development'
      ? { content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" } }
      : {}),
  }),
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@gen': path.resolve(__dirname, './types/python-generated'),
      },
    },
    build: {
      sourcemap: true,
    },
  }),
  outDir: '.output',
  imports: false,
});
