import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('./reviewer-chat-store-acceptance.mjs', import.meta.url),
  'utf8',
);

function requireOriginalD261Route(driver) {
  const between = (start, end) => {
    const first = driver.indexOf(start);
    const last = driver.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `D261 boundary missing: ${start}`);
    return driver.slice(first, last);
  };
  const guest = between(
    'async function runOriginalGuestPrelude(',
    '/** Passive runtime message proof',
  );
  assert.match(guest, /createGuestInputDriver\(/);
  assert.match(guest, /watchGuestAiRequests\(/);
  assert.match(guest, /\['opening', GUEST_QUESTION/);
  assert.match(guest, /\['same_conversation_followup', GUEST_FOLLOWUP/);
  assert.match(guest, /requests\[1\]\.is_new, false/);
  assert.match(
    guest,
    /requests\[1\]\.conversation_fingerprint, requests\[0\]\.conversation_fingerprint/,
  );
  assert.match(guest, /row\.pending_tool_count === 0/);

  const route = between('      let web = null;', '        if (!MAGIC_LINK) {');
  assert.match(route, /await runOriginalGuestPrelude\(native, guestMarker\)/);
  assert.ok(
    route.indexOf('runOriginalGuestPrelude(native, guestMarker)') <
      route.indexOf('page.context().newPage()'),
    'guest sends must precede the first-party login tab',
  );

  assert.match(
    driver,
    /On this demo page, what is the main heading and what are the three table stages\? Answer from the page\./,
  );
  const member = between(
    "        stage = 'original_member_normal_panel_reload';",
    "        stage = 'reviewer_chat_transport';",
  );
  assert.match(member, /await panel\.send\('Page\.reload', \{ ignoreCache: false \}\)/);
  assert.match(member, /freshMemberChat\.replyCount,\s*0/);
  assert.match(member, /startMemberPageTextProof\(panel, demoHeading\)/);
  assert.match(member, /\[demoHeading, 'Capture', 'Understand', 'Use'\]/);
  assert.match(
    member,
    /event\.phase === 'completed' && event\.result_has_heading && event\.result_has_stages/,
  );
}

test('D261 hosted member acceptance requires the original guest-to-member path and Page Text answer', () => {
  requireOriginalD261Route(source);
  for (const missing of [
    'await runOriginalGuestPrelude(native, guestMarker)',
    "await panel.send('Page.reload', { ignoreCache: false })",
    "[demoHeading, 'Capture', 'Understand', 'Use']",
    'event.result_has_heading && event.result_has_stages',
  ]) {
    const scope =
      missing === "await panel.send('Page.reload', { ignoreCache: false })"
        ? source.indexOf("        stage = 'original_member_normal_panel_reload';")
        : 0;
    const removal = source.indexOf(missing, scope);
    assert.ok(removal >= 0, `test mutation must find ${missing}`);
    assert.throws(
      () =>
        requireOriginalD261Route(source.slice(0, removal) + source.slice(removal + missing.length)),
      { code: 'ERR_ASSERTION' },
      `removing ${missing} must turn D261 acceptance red`,
    );
  }
});
