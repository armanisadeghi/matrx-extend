import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertImageGroups, assertLinkPane, assertMediaPane } from './scrape-media-assertions.mjs';

const image = {
  href: 'http://127.0.0.1:3150/intake.svg',
  src: 'http://127.0.0.1:3150/intake.svg',
  alt: 'New patient intake desk',
  complete: true,
  naturalWidth: 640,
  naturalHeight: 480,
};
const expectedImage = { href: image.href, src: image.src, alt: image.alt };
const video = {
  href: 'http://127.0.0.1:3150/intake-walkthrough.mp4',
  text: 'http://127.0.0.1:3150/intake-walkthrough.mp4',
};
const pane = (label, items) => ({
  selected: label,
  visible: true,
  resultText: `Add ${label === 'Images' ? 'image' : 'video'} URL`,
  media: {
    tabCount: items.length ? String(items.length) : null,
    imageItems: label === 'Images' ? items : [],
    videoItems: label === 'Video' ? items : [],
  },
});

test('image size assertion reads authored toolbar label and exact rendered group identities', () => {
  const large = image.src;
  const medium = 'http://127.0.0.1:3150/appointment-card.svg';
  const icon = 'http://127.0.0.1:3150/clinic-icon.svg';
  const state = {
    selected: 'Images',
    visible: true,
    // Chromium innerText reflects the toolbar's CSS uppercase styling.
    resultText: '1 IMAGE · 1 SMALL · 1 ICON',
    media: {
      imageToolbar: '1 image · 1 small · 1 icon',
      imageGroups: { large: [large], medium: [medium], icon: [icon] },
    },
  };
  const expected = { large: [large], medium: [medium], icon: [icon] };
  assert.doesNotThrow(() => assertImageGroups(state, expected, 'warm'));
  assert.throws(
    () =>
      assertImageGroups(
        {
          ...state,
          media: {
            ...state.media,
            imageGroups: { large: [large], medium: [icon], icon: [medium] },
          },
        },
        expected,
        'warm',
      ),
    /image_group_membership/,
  );
  assert.throws(
    () =>
      assertImageGroups(
        { ...state, media: { ...state.media, imageToolbar: '3 images' } },
        expected,
        'warm',
      ),
    /image_toolbar_count/,
  );
  const remaining = { large: [large], medium: [], icon: [icon] };
  assert.doesNotThrow(() =>
    assertImageGroups(
      {
        ...state,
        media: {
          imageToolbar: '1 image · 1 icon',
          imageGroups: remaining,
        },
      },
      remaining,
      'removed_medium',
    ),
  );
  assert.throws(
    () => assertImageGroups(state, remaining, 'removed_medium'),
    /image_group_membership/,
  );
});

test('active rendered Images and Video panes accept their distinct media', () => {
  assert.deepEqual(
    assertMediaPane(pane('Images', [image]), { label: 'Images', items: [expectedImage] }),
    {
      pane: 'Images',
      state: 'matching_content',
      count: 1,
      paths: ['/intake.svg'],
      alt: ['New patient intake desk'],
      natural_sizes: [[640, 480]],
    },
  );
  assert.deepEqual(assertMediaPane(pane('Video', [video]), { label: 'Video', items: [video] }), {
    pane: 'Video',
    state: 'matching_content',
    count: 1,
    paths: ['/intake-walkthrough.mp4'],
  });
});

test('wrong pane, absent media, and swapped media fail the native assertion', () => {
  assert.throws(
    () => assertMediaPane(pane('Video', [video]), { label: 'Images', items: [expectedImage] }),
    /wrong_selected_pane/,
  );
  assert.throws(
    () => assertMediaPane(pane('Images', []), { label: 'Images', items: [expectedImage] }),
    /tab_count_mismatch/,
  );
  const wrong = pane('Images', [image]);
  wrong.media.imageItems = [{ ...image, href: video.href }];
  assert.throws(
    () => assertMediaPane(wrong, { label: 'Images', items: [expectedImage] }),
    /rendered_media_mismatch/,
  );
});

test('selective image removal requires the exact remaining large, medium, and icon identities', () => {
  const medium = {
    ...image,
    href: 'http://127.0.0.1:3150/appointment-card.svg',
    src: 'http://127.0.0.1:3150/appointment-card.svg',
    alt: 'Appointment card',
    naturalWidth: 96,
    naturalHeight: 96,
  };
  const icon = {
    ...image,
    href: 'http://127.0.0.1:3150/clinic-icon.svg',
    src: 'http://127.0.0.1:3150/clinic-icon.svg',
    alt: 'Clinic icon',
    naturalWidth: 32,
    naturalHeight: 32,
  };
  const expected = [image, medium, icon].map(({ href, src, alt }) => ({ href, src, alt }));
  assert.deepEqual(
    assertMediaPane(pane('Images', [image, medium, icon]), { label: 'Images', items: expected })
      .paths,
    ['/intake.svg', '/appointment-card.svg', '/clinic-icon.svg'],
  );
  assert.deepEqual(
    assertMediaPane(pane('Images', [image, icon]), {
      label: 'Images',
      items: [expected[0], expected[2]],
    }).paths,
    ['/intake.svg', '/clinic-icon.svg'],
  );
  assert.throws(
    () =>
      assertMediaPane(pane('Images', []), { label: 'Images', items: [expected[0], expected[2]] }),
    /tab_count_mismatch/,
  );
  assert.throws(
    () =>
      assertMediaPane(pane('Images', [image, medium]), {
        label: 'Images',
        items: [expected[0], expected[2]],
      }),
    /rendered_media_mismatch/,
  );
});

test('failed or incomplete image load cannot pass matching Images pane', () => {
  for (const failed of [
    { ...image, complete: false },
    { ...image, naturalWidth: 0 },
    { ...image, naturalHeight: 0 },
  ]) {
    assert.throws(
      () => assertMediaPane(pane('Images', [failed]), { label: 'Images', items: [expectedImage] }),
      /image_incomplete|image_not_loaded/,
    );
  }
});

test('honest empty panes pass and nonempty content cannot masquerade as empty', () => {
  for (const label of ['Images', 'Video']) {
    assert.equal(assertMediaPane(pane(label, []), { label, items: [] }).state, 'empty');
  }
  assert.throws(
    () => assertMediaPane(pane('Video', [video]), { label: 'Video', items: [] }),
    /tab_count_mismatch/,
  );
  const falseEmpty = pane('Images', []);
  falseEmpty.media.imageItems = [image];
  assert.throws(
    () => assertMediaPane(falseEmpty, { label: 'Images', items: [] }),
    /rendered_media_mismatch/,
  );
});

test('an open Add form still exposes the selected media pane', () => {
  const open = pane('Images', [image]);
  open.resultText = 'Add Cancel';
  open.media.formOpen = true;
  assert.equal(assertMediaPane(open, { label: 'Images', items: [expectedImage] }).count, 1);
  open.media.formOpen = false;
  assert.throws(
    () => assertMediaPane(open, { label: 'Images', items: [expectedImage] }),
    /pane_controls_missing/,
  );
});

test('link assertion keeps exact survivors through removal, add, and cancellation', () => {
  const forms = { href: 'http://127.0.0.1:3150/forms', text: 'Patient forms' };
  const appointments = { href: 'http://127.0.0.1:3150/appointments', text: 'Appointments' };
  const referrals = { href: 'http://127.0.0.1:3150/referrals', text: 'Referral hours' };
  const links = (items) => ({
    selected: 'Links',
    visible: true,
    resultText: 'Add link',
    media: {
      linkItems: items,
      tabCount: String(items.length),
      linkToolbar: `${items.length} link${items.length === 1 ? '' : 's'}`,
    },
  });
  assert.deepEqual(
    assertLinkPane(links([forms, appointments]), [forms, appointments], 'before').paths,
    ['/forms', '/appointments'],
  );
  assert.deepEqual(assertLinkPane(links([appointments]), [appointments], 'removed').texts, [
    'Appointments',
  ]);
  assert.deepEqual(
    assertLinkPane(links([appointments, referrals]), [appointments, referrals], 'added').texts,
    ['Appointments', 'Referral hours'],
  );
  assert.throws(
    () => assertLinkPane(links([forms, appointments]), [appointments, referrals], 'cancelled'),
    /link_identities/,
  );
  assert.throws(
    () => assertLinkPane(links([appointments, referrals]), [appointments], 'removed'),
    /link_identities/,
  );
  const wrongCount = links([appointments]);
  wrongCount.media.linkToolbar = '2 links';
  assert.throws(() => assertLinkPane(wrongCount, [appointments], 'count'), /toolbar_count/);
});
