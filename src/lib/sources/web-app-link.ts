import { ENV } from '@/config/env';

/**
 * Where a Source opens in the AI Matrx web app — ONE constant, one place.
 *
 * Today that is the live document viewer (`/knowledge/viewer/[id]`, the
 * citation deep-link target). The one Source screen (`/knowledge/sources/[id]`)
 * arrives in SOURCE-CONVERGENCE Phase 2, and the viewer route then redirects
 * to it with its params; change this path then, and only here.
 */
export const SOURCE_WEB_APP_PATH = '/knowledge/viewer/';

export function sourceWebAppUrl(processedDocumentId: string): string {
  const base = ENV.FRONTEND_URL.replace(/\/+$/, '');
  return `${base}${SOURCE_WEB_APP_PATH}${encodeURIComponent(processedDocumentId)}`;
}
