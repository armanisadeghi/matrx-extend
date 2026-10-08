import assert from 'node:assert/strict';

// The source is read from the owned public tab, independently of the SEO pane.
// These are the paste-ready tags promised by the social copy action.
export function expectedMissingSocialTags(source) {
  const { title, description, canonical, url, social } = source;
  const esc = (value) => value.replace(/"/g, '&quot;');
  const lines = [];
  if (!social.title && title) lines.push(`<meta property="og:title" content="${esc(title)}" />`);
  if (!social.description && description)
    lines.push(`<meta property="og:description" content="${esc(description)}" />`);
  if (!social.url && (canonical || url))
    lines.push(`<meta property="og:url" content="${esc(canonical || url)}" />`);
  if (!social.type) lines.push('<meta property="og:type" content="website" />');
  if (!social.card) lines.push('<meta name="twitter:card" content="summary_large_image" />');
  if (!social.image)
    lines.push('<meta property="og:image" content="https://example.com/your-share-image.png" />');
  return lines.join('\n');
}

export function verifySocialClipboard(actual, source) {
  const expected = expectedMissingSocialTags(source);
  assert.ok(expected.includes('property="og:title"'), 'source must expose a missing social title');
  assert.equal(actual, expected, 'copied social tags match the owned page metadata exactly');
  return { copiedTags: expected.split('\n').length, exactClipboardMatch: true };
}

export function verifyManualRecapture(before, changed, stale, refreshed) {
  assert.notEqual(before.title, changed.title, 'owned public title changed before re-audit');
  assert.notEqual(
    before.description,
    changed.description,
    'owned public description changed before re-audit',
  );
  assert.equal(stale.title, before.title, 'old native audit remains before the trusted click');
  assert.equal(refreshed.title, changed.title, 'native re-audit uses changed public title');
  assert.equal(refreshed.reAudit, true, 'native re-audit settles to an available action');
  assert.equal(refreshed.error, false, 'native re-audit has no failure');
  return {
    publicTitleChanged: true,
    publicDescriptionChanged: true,
    oldAuditVisibleBeforeClick: true,
    nativeTitleMatchesChangedPublicDom: true,
  };
}
