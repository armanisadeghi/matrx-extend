/** Browser-realm reader for the canonical @ai-matrx/auth extension session. Never export tokens. */
export const nativeOAuthBearerExpression = `(await chrome.storage.local.get('matrx.oauth.session').then((stored) => {
  try { const session = JSON.parse(stored['matrx.oauth.session']);
    return session?.v === 1 && typeof session.accessToken === 'string' && session.accessToken ? session.accessToken : null;
  } catch { return null; }
}))`;
