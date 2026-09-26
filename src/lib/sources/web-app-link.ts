import { ENV } from '@/config/env';

/**
 * Where a Source opens in the AI Matrx web app — ONE constant, one place.
 *
 * The one Source screen, `/knowledge/sources/[id]` (SOURCE-CONVERGENCE
 * Phase 2); the old `/knowledge/viewer/[id]` only redirects there now.
 */
export const SOURCE_WEB_APP_PATH = '/knowledge/sources/';

export function sourceWebAppUrl(processedDocumentId: string): string {
  const base = ENV.FRONTEND_URL.replace(/\/+$/, '');
  return `${base}${SOURCE_WEB_APP_PATH}${encodeURIComponent(processedDocumentId)}`;
}
