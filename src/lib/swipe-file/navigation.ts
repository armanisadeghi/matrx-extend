import { ENV } from '@/config/env';

export const SWIPE_OPEN_KEY = 'matrx.swipe.open';

export function swipePostWebUrl(postId: string, organizationId: string): string {
  const url = new URL('/projects', ENV.FRONTEND_URL);
  url.searchParams.set('panels', `social_post:${postId}:o-${organizationId}`);
  return url.toString();
}
