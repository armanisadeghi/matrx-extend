/** Browser-realm readers for the canonical @ai-matrx/auth extension session. */
export function nativeOAuthBearerFromSession(serialized) {
  try {
    const session = JSON.parse(serialized);
    return session?.v === 1 && typeof session.accessToken === 'string' && session.accessToken
      ? session.accessToken
      : null;
  } catch {
    return null;
  }
}

// Embed the reader in the browser realm; bearer values never cross CDP into receipts.
export const nativeOAuthStoredBearerExpression = `(${nativeOAuthBearerFromSession.toString()})(stored['matrx.oauth.session'])`;
export const nativeOAuthBearerExpression = `(await chrome.storage.local.get('matrx.oauth.session').then((stored) => ${nativeOAuthStoredBearerExpression}))`;
