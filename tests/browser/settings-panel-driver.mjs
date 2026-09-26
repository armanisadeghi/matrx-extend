import assert from 'node:assert/strict';

// DOM observation/viewport preparation plus trusted CDP input in the owned panel.
export async function evaluate(panel, expression) {
  const response = await panel.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error('panel_runtime_exception');
  return response.result?.value;
}

export async function waitFor(label, read, accept, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    try {
      last = await read();
    } catch (error) {
      // A panel reload briefly destroys its JavaScript execution context.
      last = { transient: String(error?.message ?? error) };
    }
    if (accept(last)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  } while (Date.now() < deadline);
  throw new Error(`${label}_not_observed:${JSON.stringify(last)}`);
}

export async function openSection(panel, label) {
  const section = await waitFor(
    `${label}_section_ready`,
    () =>
      evaluate(
        panel,
        `(() => {
    const buttons = [...document.querySelectorAll('button[aria-expanded]')]
      .filter((el) => el.textContent.trim() === ${JSON.stringify(label)});
    return { count: buttons.length, expanded: buttons[0]?.getAttribute('aria-expanded') ?? null };
  })()`,
      ),
    (state) => state?.count === 1 && (state.expanded === 'true' || state.expanded === 'false'),
  );
  const expanded = section.expanded;
  if (expanded === 'false') await click(panel, 'section', label);
  await waitFor(
    `${label}_expanded`,
    () =>
      evaluate(
        panel,
        `(() =>
    [...document.querySelectorAll('button[aria-expanded]')]
      .find((el) => el.textContent.trim() === ${JSON.stringify(label)})
      ?.getAttribute('aria-expanded'))()`,
      ),
    (value) => value === 'true',
  );
}

// Transport only this allowlisted summary into sensitive acceptance receipts.
// Never derive a category from raw browser/transport exception messages.
function pointerFailure(code, location) {
  const message =
    code === 'pointer_target_not_unique'
      ? 'unique visible pointer target'
      : code === 'pointer_stable_hit_not_observed'
        ? 'stable hit target for pointer'
        : code === 'pointer_followup_evaluation_failed' || code === 'pointer_page_sample_failed'
          ? 'pointer_sample_failed for pointer'
          : code;
  const error = new Error(message);
  const pointer = location?.pointerDiagnostic;
  error.driverFailure = {
    code,
    sampleStage: location?.sampleFailureStage ?? null,
    matchedTargetCount: Number.isInteger(location?.matchedCount) ? location.matchedCount : null,
    visibleMatchCount: Number.isInteger(location?.count) ? location.count : null,
    uniqueVisibleTarget: location?.count === 1,
    hitTarget: location?.hitTarget === true,
    animating: location?.animating === true,
    stableSamples: location?.stableSamples ?? 0,
    positionStable: location?.positionStable === true,
    targetHasArea: pointer ? pointer.target_rect.width > 0 && pointer.target_rect.height > 0 : null,
    clippedTargetHasArea: pointer
      ? pointer.clipped_rect.width > 0 && pointer.clipped_rect.height > 0
      : null,
    selectedPointAvailable: pointer?.selected_point_available ?? null,
    centerHitCategory: pointer?.center_hit_category ?? null,
    targetDisabled: pointer?.target_disabled ?? null,
    pointerEventsNone: pointer?.target_pointer_events_none ?? null,
    clippingAncestorCount: pointer?.clipping_ancestor_count ?? null,
    testedPointCount: pointer?.tested_point_count ?? null,
    interiorHitKinds: pointer?.interior_hit_kinds ?? null,
    targetRectangle: pointer?.target_rect ?? null,
    centerOccluder: pointer?.center_occluder ?? null,
    firstInteriorOccluder: pointer?.first_interior_occluder ?? null,
  };
  return error;
}

export async function click(panel, kind, label) {
  const pointerSample = () =>
    evaluate(
      panel,
      `(() => {
    const kind = ${JSON.stringify(kind)}, label = ${JSON.stringify(label)};
    let sampleFailureStage = 'target_resolution';
    try {
    const visible = (el) => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
        style.display !== 'none' && !el.closest('[inert]');
    };
    let candidates;
    if (kind === 'title') candidates = [...document.querySelectorAll('button[title]')]
      .filter((el) => el.title === label);
    else if (kind === 'section') candidates = [...document.querySelectorAll('button[aria-expanded]')]
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'theme') candidates = [...document.querySelectorAll('span')]
      .filter((el) => el.textContent.trim() === 'Theme')
      .flatMap((el) => [...el.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
    else if (kind === 'organization') candidates = [...document.querySelectorAll('span')]
      .filter((el) => el.textContent.trim() === 'Acting as')
      .flatMap((el) => [...el.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
    else if (kind === 'capture-no-workspace-dismiss') candidates = [...document.querySelectorAll('[role="alert"]')]
      .filter((el) => el.querySelector('.font-medium')?.textContent.trim() === 'Capture list unavailable'
        && el.querySelector('p')?.textContent.includes('no workspace is selected, so the request was never sent'))
      .flatMap((el) => [...el.querySelectorAll('button[aria-label="Dismiss"]')]);
    else if (kind === 'port') candidates = [...document.querySelectorAll('input[placeholder="auto"]')];
    else if (kind === 'switch') candidates = [...document.querySelectorAll('[role="switch"][aria-label]')]
      .filter((el) => el.getAttribute('aria-label') === label);
    else if (kind === 'option') candidates = [...document.querySelectorAll('[role="option"]')]
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'organization-picker-choice') candidates = [...document.querySelectorAll('[role="dialog"]')]
      .filter((el) => el.textContent.includes('Which organization are you working in?'))
      .flatMap((el) => [...el.querySelectorAll('button[role="option"]')])
      .filter((el) => [...el.querySelectorAll('span.truncate')]
        .some((name) => name.textContent.trim() === label));
    else if (kind === 'vault-shared-tab') {
      // Scope the changing count label to the active Vault panel. The caller
      // still uses this driver's visible, hit-tested, trusted pointer path.
      const vaultTriggers = [...document.querySelectorAll('button[role="tab"][title="Vault"][data-state="active"]')];
      const vaultTrigger = vaultTriggers.length === 1 ? vaultTriggers[0] : null;
      const panelId = vaultTrigger?.getAttribute('aria-controls') ?? '';
      const vaultPanel = panelId ? document.getElementById(panelId) : null;
      const activeVaultPanel = vaultPanel?.matches('[role="tabpanel"][data-state="active"]') ? vaultPanel : null;
      candidates = label === 'Shared'
        ? [...(activeVaultPanel?.querySelectorAll('button[role="tab"]') ?? [])].filter((el) => {
            const text = el.textContent.trim();
            return text.startsWith('Shared (') && text.endsWith(')') &&
              /^[0-9]+$/.test(text.slice(8, -1));
          })
        : [];
    }
    else if (kind === 'dialog') candidates = [...document.querySelectorAll('[role="alertdialog"]')]
      .filter((el) => el.querySelector('[data-slot="alert-dialog-title"]')?.textContent.trim() === 'Clear local data?')
      .flatMap((el) => [...el.querySelectorAll('button')])
      .filter((el) => el.textContent.trim() === label);
    else candidates = [...document.querySelectorAll('button')]
      .filter((el) => el.textContent.trim() === label);
    sampleFailureStage = 'visibility_filter';
    const matchedCount = candidates.length;
    candidates = candidates.filter(visible);
    if (candidates.length !== 1) return { count: candidates.length, matchedCount };
    const target = candidates[0];
    // Viewport preparation is not the acceptance action. Reposition on every
    // sample because an expanding section can invalidate a one-shot scroll.
    // Never click unless the real target subsequently passes hit-testing.
    sampleFailureStage = 'scroll_preparation';
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    sampleFailureStage = 'clipping_geometry';
    const rect = target.getBoundingClientRect();
    // A viewport-visible center can still lie outside a nested overflow clip.
    // Intersect every clipping ancestor, then use only points that the browser
    // says actually hit this target. Never dismiss an overlay or invoke click().
    const bounds = { left: Math.max(0, rect.left), top: Math.max(0, rect.top),
      right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) };
    let clippingAncestors = 0;
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
      const clips = (overflow) => /^(auto|scroll|hidden|clip)$/.test(overflow);
      if (clips(style.overflowX)) {
        bounds.left = Math.max(bounds.left, box.left + ancestor.clientLeft);
        bounds.right = Math.min(bounds.right, box.left + ancestor.clientLeft + ancestor.clientWidth);
      }
      if (clips(style.overflowY)) {
        clippingAncestors++;
        bounds.top = Math.max(bounds.top, box.top + ancestor.clientTop);
        bounds.bottom = Math.min(bounds.bottom, box.top + ancestor.clientTop + ancestor.clientHeight);
      }
    }
    sampleFailureStage = 'hit_testing';
    const originalCenter = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const centerHit = document.elementFromPoint(originalCenter.x, originalCenter.y);
    const hitsTarget = (hit) => Boolean(hit && (hit === target || target.contains(hit)));
    const points = [];
    if (bounds.right > bounds.left && bounds.bottom > bounds.top) {
      for (const fy of [0.5, 0.25, 0.75]) for (const fx of [0.5, 0.25, 0.75]) {
        points.push({ x: bounds.left + (bounds.right - bounds.left) * fx,
          y: bounds.top + (bounds.bottom - bounds.top) * fy });
      }
    }
    const selected = points.find((point) => hitsTarget(document.elementFromPoint(point.x, point.y)));
    const { x, y } = selected ?? originalCenter;
    const hitTarget = Boolean(selected) && !target.disabled;
    const hitCategory = (hit) => {
      if (!hit) return 'none';
      if (hitsTarget(hit)) return 'target';
      if (hit.closest('[role="alertdialog"], [role="dialog"]')) return 'dialog';
      if (hit.closest('[role="listbox"]')) return 'listbox';
      if (hit.closest('[data-slot="alert-dialog-overlay"], [data-slot="dialog-overlay"]')) return 'modal_overlay';
      if (hit.contains(target)) return 'target_ancestor';
      if (hit.closest('header, [role="tablist"]')) return 'header_or_tabs';
      return 'other_element';
    };
    // Fixed, content-free semantics at the exact pointer boundary. An
    // "other_element" result alone cannot distinguish a notice, scrolling
    // sibling, or outside overlay; no DOM text, attributes, classes, URLs, or
    // field values may cross from this credential-bearing page.
    const occluder = (hit) => {
      if (!hit || hitsTarget(hit)) return null;
      const tag = hit.tagName?.toLowerCase();
      const role = hit.getAttribute?.('role');
      const style = getComputedStyle(hit);
      const box = hit.getBoundingClientRect();
      const vaultPanel = target.closest('[role="tabpanel"]');
      const panelAncestors = [];
      for (let node = hit; node; node = node.parentElement) {
        if (node.getAttribute?.('role') === 'tabpanel') panelAncestors.push(node);
      }
      const panelTitles = [
        ['chat', 'Chat'], ['pilot', 'Pilot (admin only — sandboxed tab group)'],
        ['lists', 'Plan & tasks'], ['tasks', 'Tasks'], ['agenda', 'Agenda'],
        ['scrape', 'Scrape'], ['saved_captures', 'Saved captures'],
        ['data', 'Data'], ['seo', 'SEO'], ['highlight', 'Highlights'],
        ['guidance', 'Guidance'], ['notes', 'Notes'], ['files', 'Files'],
        ['screenshots', 'Screenshots'], ['vault', 'Vault'], ['tools', 'Tools'],
        ['settings', 'Settings'], ['showcase', 'Showcase (admin only)'],
        ['broker', 'Token broker (admin only)'], ['debug', 'Debug (admin only)'],
      ];
      const owner = panelTitles.find(([, title]) => {
        const trigger = [...document.querySelectorAll('button[role="tab"][title]')]
          .find((button) => button.title === title);
        return trigger && panelAncestors.includes(document.getElementById(trigger.getAttribute('aria-controls') ?? ''));
      })?.[0] ?? (panelAncestors.length ? 'unmapped_tabpanel' : 'none');
      const owningPanel = panelAncestors[0] ?? null;
      // Compare only fixed source copy inside the page. No paragraph text is
      // returned to Node, including when it contains account or Vault data.
      const paragraph = hit.closest('p');
      const alert = hit.closest('[role="alert"]');
      const alertTitle = alert?.querySelector('.font-medium')?.textContent?.trim();
      const alertMessage = alert?.querySelector('p')?.textContent ?? '';
      const knownNotice = alertTitle === 'Capture list unavailable' &&
        alertMessage.includes('no workspace is selected, so the request was never sent')
          ? 'capture_no_workspace'
          : alertMessage.includes('no workspace is selected, so the request was never sent')
            ? 'other_no_workspace'
            : alertMessage.includes('the database refused the request because your account is not allowed')
              ? 'database_refused'
              : alertMessage.includes('the data table this feature needs is not available')
                ? 'database_missing_relation'
                : alertMessage.includes('your sign-in has expired')
                  ? 'database_not_authenticated'
                  : alertMessage.includes('the database could not be reached')
                    ? 'database_unreachable'
                    : alert ? 'other_alert' : 'none';
      const knownParagraph = paragraph?.textContent?.trim() ===
        'Everything AI Matrx does for you happens inside one organization, and this browser has not been told which one to use. Pick it once — you can switch any time in Settings.'
          ? 'organization_picker_description'
          : paragraph?.textContent?.trim() === 'No logins saved yet.'
            ? 'vault_mine_empty'
            : paragraph?.textContent?.trim() === 'Nobody has shared a login with you.'
              ? 'vault_shared_empty'
              : paragraph?.textContent?.trim() === 'No logins match that search.'
                ? 'vault_search_empty' : 'other_or_none';
      const knownSlot = (element) => {
        const slot = element.getAttribute?.('data-slot');
        return ['dialog-content', 'dialog-description', 'dialog-overlay',
          'alert-dialog-content', 'alert-dialog-description', 'alert-dialog-overlay',
          'popover-content', 'tooltip-content'].includes(slot) ? slot : 'other_or_none';
      };
      const ancestorChain = [];
      for (let node = hit, depth = 0; node && depth < 10; node = node.parentElement, depth++) {
        const nodeTag = node.tagName?.toLowerCase();
        const nodeRole = node.getAttribute?.('role');
        const nodeState = node.getAttribute?.('data-state');
        const nodeStyle = getComputedStyle(node);
        ancestorChain.push({
          tag: ['button', 'div', 'span', 'svg', 'path', 'input', 'header', 'main',
            'section', 'p', 'li', 'body', 'html'].includes(nodeTag) ? nodeTag : 'other',
          role: ['dialog', 'alertdialog', 'alert', 'tab', 'tablist', 'tabpanel',
            'button', 'listbox', 'option'].includes(nodeRole) ? nodeRole : 'other_or_none',
          slot: knownSlot(node),
          state: ['active', 'inactive', 'open', 'closed'].includes(nodeState)
            ? nodeState : 'other_or_none',
          position: ['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(nodeStyle.position)
            ? nodeStyle.position : 'other',
          displayNone: nodeStyle.display === 'none',
          pointerEventsNone: nodeStyle.pointerEvents === 'none',
          isAppRoot: node === document.getElementById('app'),
          isVaultPanel: node === vaultPanel,
        });
      }
      return {
        tag: ['button', 'div', 'span', 'svg', 'path', 'input', 'header', 'main',
          'section', 'p', 'li'].includes(tag) ? tag : 'other',
        role: ['dialog', 'alertdialog', 'alert', 'tab', 'tablist', 'button',
          'listbox', 'option'].includes(role) ? role : 'other_or_none',
        relation: hit.contains(target) ? 'target_ancestor'
          : target.closest('[role="tablist"]') &&
              hit.closest('[role="tablist"]') === target.closest('[role="tablist"]')
            ? 'same_tablist'
            : vaultPanel?.contains(hit) ? 'same_vault_panel' : 'outside_vault_panel',
        position: ['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(style.position)
          ? style.position : 'other',
        pointer_events: style.pointerEvents === 'none' ? 'none' : 'enabled',
        owning_panel: owner,
        owning_panel_state: owningPanel?.getAttribute('data-state') === 'active' ? 'active'
          : owningPanel?.getAttribute('data-state') === 'inactive' ? 'inactive' : 'none_or_other',
        tabpanel_ancestor_count: panelAncestors.length,
        known_paragraph: knownParagraph,
        known_notice: knownNotice,
        in_app_root: document.getElementById('app')?.contains(hit) === true,
        in_dialog: Boolean(hit.closest('[role="dialog"], [role="alertdialog"]')),
        in_alert: Boolean(hit.closest('[role="alert"]')),
        in_known_modal_overlay: Boolean(hit.closest('[data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"]')),
        ancestor_chain: ancestorChain,
        rectangle: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    };
    const interiorHits = points.map((point) => document.elementFromPoint(point.x, point.y));
    const interiorHitKinds = interiorHits.map(hitCategory);
    // Fixed categories and geometry only: never element text, attributes,
    // class names, form values, URL, or screenshot contents.
    const pointerDiagnostic = {
      target_rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      clipped_rect: { x: bounds.left, y: bounds.top,
        width: Math.max(0, bounds.right - bounds.left), height: Math.max(0, bounds.bottom - bounds.top) },
      viewport: { width: innerWidth, height: innerHeight },
      clipping_ancestor_count: clippingAncestors,
      tested_point_count: points.length,
      center_hit_category: hitCategory(centerHit),
      interior_hit_kinds: interiorHitKinds,
      center_occluder: occluder(centerHit),
      first_interior_occluder: occluder(interiorHits.find((hit) => hit && !hitsTarget(hit))),
      selected_point_available: Boolean(selected),
      selected_point: selected ?? null,
      target_disabled: Boolean(target.disabled),
      target_pointer_events_none: getComputedStyle(target).pointerEvents === 'none',
    };
    sampleFailureStage = 'animation_observation';
    let animating = false;
    for (let ancestor = target; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.getAnimations({ subtree: false }).some((animation) => animation.playState === 'running')) {
        animating = true;
        break;
      }
    }
    return { count: 1, matchedCount, x, y, hitTarget, animating,
      viewport: { width: innerWidth, height: innerHeight },
      pointerDiagnostic };
    } catch {
      return { sampleFailed: true, sampleFailureStage };
    }
  })()`,
    );
  let location;
  try {
    location = await pointerSample();
  } catch {
    throw pointerFailure('pointer_initial_evaluation_failed', location);
  }
  if (location?.sampleFailed) throw pointerFailure('pointer_page_sample_failed', location);
  if (location?.count !== 1) throw pointerFailure('pointer_target_not_unique', location);
  // Poll outside the page: a paused requestAnimationFrame must not strand
  // Runtime.evaluate(awaitPromise) or hide the last pointer diagnostic.
  const deadline = Date.now() + 3000;
  let previous;
  let stableSamples = 0;
  do {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    try {
      location = await pointerSample();
    } catch {
      throw pointerFailure('pointer_followup_evaluation_failed', location);
    }
    if (location?.sampleFailed) throw pointerFailure('pointer_page_sample_failed', location);
    const positionStable =
      location?.count === 1 &&
      previous !== undefined &&
      Math.abs(previous.x - location.x) < 0.25 &&
      Math.abs(previous.y - location.y) < 0.25;
    stableSamples =
      location?.count === 1 && location.hitTarget && !location.animating && positionStable
        ? stableSamples + 1
        : 0;
    location = { ...location, stableSamples, positionStable };
    if (stableSamples >= 2) break;
    previous = location?.count === 1 ? { x: location.x, y: location.y } : undefined;
  } while (Date.now() < deadline);
  if (stableSamples < 2) {
    const error = pointerFailure('pointer_stable_hit_not_observed', location);
    error.pointerDiagnostic = location?.pointerDiagnostic ?? { sample_unavailable: true };
    throw error;
  }
  try {
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: location.x,
      y: location.y,
      button: 'left',
      clickCount: 1,
    });
  } catch {
    throw pointerFailure('pointer_press_dispatch_failed', location);
  }
  try {
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: location.x,
      y: location.y,
      button: 'left',
      clickCount: 1,
    });
  } catch {
    throw pointerFailure('pointer_release_dispatch_failed', location);
  }
  if (kind === 'port') {
    const focused = await evaluate(
      panel,
      `(() => {
      const input = document.querySelector('input[placeholder="auto"]');
      return input !== null && document.activeElement === input;
    })()`,
    );
    assert.equal(
      focused,
      true,
      `real mouse click focused port input: ${JSON.stringify({ location, focused })}`,
    );
  }
  return location.pointerDiagnostic;
}
