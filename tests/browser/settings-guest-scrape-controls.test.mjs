import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scrapeModeMatches,
  scrapeSwitchMatches,
  sectionMatches,
} from './settings-guest-scrape-controls.mjs';

test('auto-scrape switch evidence rejects a missing write or stale visible state', () => {
  for (const expected of [false, true]) {
    const matching = {
      active: true,
      sectionOpen: true,
      count: 1,
      visible: expected,
      stored: expected,
    };
    assert.equal(scrapeSwitchMatches(matching, expected), true);
    assert.equal(scrapeSwitchMatches({ ...matching, stored: !expected }, expected), false);
    assert.equal(scrapeSwitchMatches({ ...matching, visible: !expected }, expected), false);
    assert.equal(scrapeSwitchMatches({ ...matching, count: 0 }, expected), false);
  }
});

test('auto-scrape mode evidence requires both selected labels and persisted values', () => {
  for (const [value, label, other] of [
    ['capture', 'Capture', 'Scroll & capture'],
    ['scroll-capture', 'Scroll & capture', 'Capture'],
  ]) {
    const matching = { active: true, sectionOpen: true, count: 1, visible: label, stored: value };
    assert.equal(scrapeModeMatches(matching, value, label), true);
    assert.equal(scrapeModeMatches({ ...matching, visible: other }, value, label), false);
    assert.equal(scrapeModeMatches({ ...matching, stored: 'wrong' }, value, label), false);
  }
});

test('section evidence rejects changed preferences, inaccessible content, or a missing guest section', () => {
  const headings = [
    'Account',
    'Organization',
    'Appearance',
    'Chat',
    'Privacy',
    'Scrape',
    'Data',
    'SEO',
    'Desktop bridge',
    'Data & reset',
    'About',
  ];
  for (const expanded of [false, true]) {
    const matching = {
      active: true,
      headings,
      count: 1,
      expanded: String(expanded),
      contentAriaHidden: String(!expanded),
      contentInert: !expanded,
      contentNonempty: true,
      emptyHint: true,
      settingsDigest: 'saved-preferences',
    };
    assert.equal(sectionMatches(matching, 'Data', expanded, 'saved-preferences'), true);
    assert.equal(
      sectionMatches(
        { ...matching, settingsDigest: 'changed' },
        'Data',
        expanded,
        'saved-preferences',
      ),
      false,
    );
    assert.equal(
      sectionMatches(
        { ...matching, contentInert: expanded },
        'Data',
        expanded,
        'saved-preferences',
      ),
      false,
    );
    assert.equal(
      sectionMatches({ ...matching, emptyHint: false }, 'Data', expanded, 'saved-preferences'),
      false,
    );
    assert.equal(
      sectionMatches(
        { ...matching, headings: headings.slice(1) },
        'Data',
        expanded,
        'saved-preferences',
      ),
      false,
    );
  }
});
