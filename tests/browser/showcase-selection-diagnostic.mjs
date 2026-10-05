const SUBSTAGES = new Set(['card_click', 'scope_choice', 'scope_badge', 'detection_relay']);
const COUNTS = new Set([
  'card_count',
  'overlay_count',
  'scope_choice_count',
  'three_card_choice_count',
]);
const FLAGS = new Set(['card_visible', 'card_center_hit', 'badge_three_items']);
const HIT_KINDS = new Set([
  'card',
  'card_ancestor',
  'picker_panel',
  'picker_other',
  'other_element',
  'none',
]);
const POINTER_MOMENTS = new Set(['before_click', 'after_failure']);

export function createShowcaseSelectionDiagnostic() {
  return { substage: 'card_click', observations: {}, pointer_samples: {} };
}

export function stageShowcaseSelection(diagnostic, substage) {
  if (SUBSTAGES.has(substage)) diagnostic.substage = substage;
}

export function observeShowcaseSelection(diagnostic, values) {
  for (const [key, value] of Object.entries(values)) {
    if (COUNTS.has(key) && Number.isSafeInteger(value) && value >= 0 && value <= 10000)
      diagnostic.observations[key] = value;
    else if (FLAGS.has(key) && (typeof value === 'boolean' || value === null))
      diagnostic.observations[key] = value;
  }
}

export function recordShowcasePointerSample(diagnostic, moment, sample) {
  if (!POINTER_MOMENTS.has(moment) || !sample || typeof sample !== 'object') return;
  const rect = (value) =>
    value &&
    ['x', 'y', 'width', 'height'].every(
      (key) =>
        typeof value[key] === 'number' &&
        Number.isFinite(value[key]) &&
        Math.abs(value[key]) < 100000,
    )
      ? { x: value.x, y: value.y, width: value.width, height: value.height }
      : null;
  diagnostic.pointer_samples[moment] = {
    viewport:
      sample.viewport &&
      ['width', 'height'].every(
        (key) =>
          Number.isFinite(sample.viewport[key]) &&
          sample.viewport[key] >= 0 &&
          sample.viewport[key] < 100000,
      )
        ? { width: sample.viewport.width, height: sample.viewport.height }
        : null,
    card_rect: rect(sample.card_rect),
    picker_panel_rect: rect(sample.picker_panel_rect),
    center_in_viewport: sample.center_in_viewport === true,
    center_hit_kind: HIT_KINDS.has(sample.center_hit_kind) ? sample.center_hit_kind : 'none',
    interior_hit_kinds: Array.isArray(sample.interior_hit_kinds)
      ? sample.interior_hit_kinds.slice(0, 9).map((kind) => (HIT_KINDS.has(kind) ? kind : 'none'))
      : [],
  };
}

export function safeShowcaseSelectionFailure(diagnostic, error) {
  const substage = SUBSTAGES.has(diagnostic?.substage) ? diagnostic.substage : 'unclassified';
  if (
    typeof error?.message === 'string' &&
    error.message.startsWith('NATIVE_RESOURCE_BOUNDARY_REFUSED:')
  )
    return 'selection_resource_boundary_refused';
  return `selection_${substage}_failed`;
}

export async function sampleShowcaseSelection(page, diagnostic, moment = null) {
  try {
    const sample = await page.evaluate(() => {
      const cards = document.querySelectorAll('#events article.event-card');
      const card = cards[0];
      const host = document.querySelector('#matrx-list-picker-host');
      const shadow = host?.shadowRoot;
      const rect = card?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width / 2 : 0;
      const y = rect ? rect.top + rect.height / 2 : 0;
      const hit = rect ? document.elementFromPoint(x, y) : null;
      const panel = shadow?.querySelector('.panel');
      const panelRect = panel?.getBoundingClientRect();
      const hitKind = (element, px, py) => {
        if (!element) return 'none';
        if (card && (card === element || card.contains(element))) return 'card';
        if (card && element.contains(card)) return 'card_ancestor';
        if (host && (element === host || host.contains(element))) {
          const shadowHit = shadow?.elementFromPoint?.(px, py);
          return shadowHit && panel?.contains(shadowHit) ? 'picker_panel' : 'picker_other';
        }
        return 'other_element';
      };
      const bounds = rect && {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        right: Math.min(innerWidth, rect.right),
        bottom: Math.min(innerHeight, rect.bottom),
      };
      const points =
        bounds && bounds.right > bounds.left && bounds.bottom > bounds.top
          ? [0.25, 0.5, 0.75].flatMap((fy) =>
              [0.25, 0.5, 0.75].map((fx) => ({
                x: bounds.left + (bounds.right - bounds.left) * fx,
                y: bounds.top + (bounds.bottom - bounds.top) * fy,
              })),
            )
          : [];
      const choices = [...(shadow?.querySelectorAll('[data-scope-choice]') ?? [])];
      return {
        card_count: cards.length,
        overlay_count: document.querySelectorAll('#matrx-list-picker-host').length,
        card_visible: Boolean(rect && rect.width > 0 && rect.height > 0),
        card_center_hit: Boolean(card && hit && (card === hit || card.contains(hit))),
        scope_choice_count: choices.length,
        three_card_choice_count: choices.filter((choice) => choice.textContent?.includes('3 cards'))
          .length,
        badge_three_items: [...(shadow?.querySelectorAll('.badge') ?? [])].some((badge) =>
          badge.textContent?.includes('3 items'),
        ),
        pointer: {
          viewport: { width: innerWidth, height: innerHeight },
          card_rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
          picker_panel_rect: panelRect
            ? { x: panelRect.x, y: panelRect.y, width: panelRect.width, height: panelRect.height }
            : null,
          center_in_viewport: Boolean(
            rect && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight,
          ),
          center_hit_kind: hitKind(hit, x, y),
          interior_hit_kinds: points.map(({ x: px, y: py }) =>
            hitKind(document.elementFromPoint(px, py), px, py),
          ),
        },
      };
    });
    observeShowcaseSelection(diagnostic, sample);
    if (moment) recordShowcasePointerSample(diagnostic, moment, sample.pointer);
  } catch {
    // A lost page context is represented by the missing observation, never raw error text.
  }
}
