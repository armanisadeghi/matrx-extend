import {
  nativeOAuthBearerFromSession,
  nativeOAuthStoredBearerExpression,
} from './native-oauth-session.mjs';
export function storedSessionSummary(
  stored,
  bearerPresent = Boolean(nativeOAuthBearerFromSession(stored['matrx.oauth.session'])),
) {
  return {
    accessTokenPresent: bearerPresent,
    profilePresent: Boolean(stored['matrx.user.profile']?.id),
    activeOrganizationPresent:
      typeof stored['matrx.org.active']?.id === 'string' &&
      stored['matrx.org.active'].id.trim().length > 0,
  };
}

export function storageShapeExpression() {
  return `(() => chrome.storage.local.get([
    'matrx.oauth.session', 'matrx.user.profile', 'matrx.org.active',
  ]).then((stored) => (${storedSessionSummary.toString()})(stored, Boolean(${nativeOAuthStoredBearerExpression}))))()`;
}
