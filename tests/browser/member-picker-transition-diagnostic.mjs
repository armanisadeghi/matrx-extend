const PHASES = new Set([
  'after_admin_check_stop',
  'before_picker_click',
  'after_picker_click',
  'after_checked_option_proof',
  'before_escape_keydown',
  'after_escape_keydown',
  'after_escape_keyup',
]);

// Organization also contains an archive filter; only the Acting as row owns this picker.
export function actingOrganizationPickersExpression(section = 'orgSection') {
  return `[...(${section}?.querySelectorAll('span') ?? [])]
    .filter((span) => span.textContent.trim() === 'Acting as')
    .flatMap((span) => [...span.parentElement.parentElement.querySelectorAll('button[role="combobox"]')])`;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 20 ? value : null;
}

/** Persist only fixed picker and panel fields before the next native input. */
export async function recordMemberPickerBoundary({ panel, phase, report, output, writeReport }) {
  if (!PHASES.has(phase)) throw new Error('member_picker_phase_invalid');
  report.organization_picker_transition ??= [];
  let snapshot = { phase, measured: false, panel_visibility: null };
  try {
    const result = await panel.send('Runtime.evaluate', {
      expression: `(() => {
        const organization = [...document.querySelectorAll('button[aria-expanded]')]
          .find(button => button.textContent.trim() === 'Organization');
        const orgSection = organization?.parentElement?.nextElementSibling;
        const pickers = ${actingOrganizationPickersExpression()};
        const picker = pickers.length === 1 ? pickers[0] : null;
        const list = picker ? document.getElementById(picker.getAttribute('aria-controls') ?? '') : null;
        return {
          visibility: document.visibilityState,
          focused: document.hasFocus(),
          picker_count: pickers.length,
          expanded: picker?.getAttribute('aria-expanded') ?? null,
          listbox_count: list?.getAttribute('role') === 'listbox' ? 1 : 0,
          checked_count: list?.querySelectorAll('[role="option"][data-state="checked"][data-value]').length ?? 0,
        };
      })()`,
      returnByValue: true,
    });
    const value = result.exceptionDetails ? null : result.result?.value;
    if (value && typeof value === 'object')
      snapshot = {
        phase,
        measured: true,
        panel_visibility: ['visible', 'hidden', 'prerender'].includes(value.visibility)
          ? value.visibility
          : null,
        panel_focused: typeof value.focused === 'boolean' ? value.focused : null,
        picker_count: safeCount(value.picker_count),
        picker_expanded:
          value.expanded === 'true' ? true : value.expanded === 'false' ? false : null,
        listbox_count: safeCount(value.listbox_count),
        checked_count: safeCount(value.checked_count),
      };
  } catch {
    // A retired renderer must be visible as an unmeasured boundary, not a private CDP error.
  }
  report.organization_picker_transition.push(snapshot);
  await writeReport(output, report);
  return snapshot;
}

/** Keep the original checked-UUID proof and Escape dismissal unchanged while sampling its boundaries. */
export async function selectedMemberOrganizationFingerprint({
  panel,
  click,
  evaluate,
  waitFor,
  hash,
  UUID,
  samplePickerBoundary,
}) {
  let sampleFailed = false;
  const sample = async (phase) => {
    try {
      await samplePickerBoundary(phase);
    } catch {
      // Preserve native input cleanup, then refuse the unpersisted diagnostic.
      sampleFailed = true;
    }
  };
  await sample('before_picker_click');
  await click(panel, 'organization', '');
  let fingerprint;
  try {
    await sample('after_picker_click');
    const selected = await waitFor(
      'member_selected_organization_option',
      () =>
        evaluate(
          panel,
          `(() => {
      const organization = [...document.querySelectorAll('button[aria-expanded]')]
        .find(button => button.textContent.trim() === 'Organization');
      const orgSection = organization?.parentElement?.nextElementSibling;
      const pickers = ${actingOrganizationPickersExpression()};
      const picker = pickers.length === 1 ? pickers[0] : null;
      const list = picker ? document.getElementById(picker.getAttribute('aria-controls') ?? '') : null;
      const checked = [...(list?.querySelectorAll('[role="option"][data-state="checked"][data-value]') ?? [])];
      return { pickerCount: pickers.length, checkedCount: checked.length,
        value: checked.length === 1 ? checked[0].getAttribute('data-value') : null,
        labelMatches: checked.length === 1 && checked[0].textContent.trim() === picker?.textContent.trim() };
    })()`,
        ),
      (value) =>
        value?.pickerCount === 1 &&
        value.checkedCount === 1 &&
        value.labelMatches &&
        UUID.test(value.value ?? ''),
      10_000,
    );
    await sample('after_checked_option_proof');
    fingerprint = hash(selected.value);
  } finally {
    await sample('before_escape_keydown');
    try {
      await panel.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await sample('after_escape_keydown');
    } finally {
      try {
        await panel.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        });
      } finally {
        await sample('after_escape_keyup');
      }
    }
  }
  if (sampleFailed) throw new Error('member_picker_trace_persist_failed');
  return fingerprint;
}
