const SUBSTAGES = new Set(['card_click', 'scope_choice', 'scope_badge', 'detection_relay']);
const COUNTS = new Set([
  'card_count',
  'overlay_count',
  'scope_choice_count',
  'three_card_choice_count',
]);
const FLAGS = new Set(['card_visible', 'card_center_hit', 'badge_three_items']);

export function createShowcaseSelectionDiagnostic() {
  return { substage: 'card_click', observations: {} };
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

export function safeShowcaseSelectionFailure(diagnostic, error) {
  const substage = SUBSTAGES.has(diagnostic?.substage) ? diagnostic.substage : 'unclassified';
  if (
    typeof error?.message === 'string' &&
    error.message.startsWith('NATIVE_RESOURCE_BOUNDARY_REFUSED:')
  )
    return 'selection_resource_boundary_refused';
  return `selection_${substage}_failed`;
}

export async function sampleShowcaseSelection(page, diagnostic) {
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
      };
    });
    observeShowcaseSelection(diagnostic, sample);
  } catch {
    // A lost page context is represented by the missing observation, never raw error text.
  }
}
