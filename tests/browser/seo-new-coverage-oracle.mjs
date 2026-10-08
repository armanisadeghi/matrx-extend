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

// This selector matches the native title click primitive: TooltipProvider may
// move the title to data-matrx-title while the pointer is over the button.
export function socialCopyButtonObservation(pane, label) {
  const buttons = [
    ...(pane?.querySelectorAll('button[title], button[data-matrx-title]') ?? []),
  ].filter(
    (button) => (button.getAttribute('title') ?? button.getAttribute('data-matrx-title')) === label,
  );
  const button = buttons.length === 1 ? buttons[0] : null;
  return {
    buttonCount: buttons.length,
    visible: !!button && button.getBoundingClientRect().width > 0,
    hasTitleAttr: !!button?.getAttribute('title'),
    hasDataTitleAttr: !!button?.getAttribute('data-matrx-title'),
    check: !!button?.querySelector('svg.lucide-check'),
    failed: !!button?.querySelector('svg.lucide-x'),
    idle: !!button?.querySelector('svg.lucide-copy'),
  };
}

// A missing transient icon is observable; an unreadable native target is not.
// Unlike the shared general waitFor, this boundary never converts read errors
// into ordinary false samples before the clipboard or T02 actions run.
export async function pollSocialFeedback(
  read,
  {
    timeoutMs,
    intervalMs = 100,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
) {
  const deadline = now() + timeoutMs;
  let state;
  for (;;) {
    state = await read();
    if (state?.check || state?.failed) return { state, iconObserved: true };
    if (now() >= deadline) return { state, iconObserved: false };
    await sleep(intervalMs);
  }
}

export function verifySocialCopyOutcome(actual, source, { feedbackFailed, previousClipboard }) {
  let verified;
  try {
    verified = verifySocialClipboard(actual, source);
  } catch {
    throw Object.assign(new Error('social_clipboard_mismatch'), {
      code: 'SOCIAL_CLIPBOARD_MISMATCH',
    });
  }
  if (feedbackFailed)
    throw Object.assign(new Error('social_copy_failure_feedback'), {
      code: 'SOCIAL_COPY_FAILURE_FEEDBACK',
    });
  if (actual === previousClipboard)
    throw Object.assign(new Error('social_clipboard_unchanged'), {
      code: 'SOCIAL_CLIPBOARD_UNCHANGED',
    });
  return verified;
}

export async function runCopyCheckThenRecapture(copyCheck, recapture) {
  const copyResult = await copyCheck();
  const recaptureResult = await recapture();
  return { copyResult, recaptureResult };
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
