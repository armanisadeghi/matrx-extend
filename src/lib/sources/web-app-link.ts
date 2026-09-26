import { ENV } from '@/config/env';

/**
 * Where a Source opens in the AI Matrx web app. The Source screen
 * (`/knowledge/sources/[id]`) arrives in SOURCE-CONVERGENCE Phase 2; until
 * then the link may land on a not-found page, which is why every button that
 * uses it says "opens in the web app" rather than promising a viewer.
 */
export function sourceWebAppUrl(processedDocumentId: string): string {
  const base = ENV.FRONTEND_URL.replace(/\/+$/, '');
  return `${base}/knowledge/sources/${encodeURIComponent(processedDocumentId)}`;
}
