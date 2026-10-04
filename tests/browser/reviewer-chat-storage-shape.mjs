export function storedSessionSummary(stored) {
  return {
    accessTokenPresent: typeof stored['matrx.auth.accessToken'] === 'string',
    profilePresent: Boolean(stored['matrx.user.profile']?.id),
    activeOrganizationPresent:
      typeof stored['matrx.org.active']?.id === 'string' &&
      stored['matrx.org.active'].id.trim().length > 0,
  };
}

export function storageShapeExpression() {
  return `(() => chrome.storage.local.get([
    'matrx.auth.accessToken', 'matrx.user.profile', 'matrx.org.active',
  ]).then((stored) => (${storedSessionSummary.toString()})(stored)))()`;
}
