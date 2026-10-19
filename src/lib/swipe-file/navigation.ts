import { ENV } from '@/config/env';
import { formatLinkToken } from '@ai-matrx/summon/open';

export const SWIPE_OPEN_KEY = 'matrx.swipe.open';

export function swipePostWebUrl(postId: string, organizationId: string): string {
  const url = new URL('/projects', ENV.FRONTEND_URL);
  url.searchParams.set(
    'panels',
    formatLinkToken({ key: 'social_post', id: postId, args: { o: organizationId } }),
  );
  return url.toString();
}
