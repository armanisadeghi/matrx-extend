// A failed native pointer must leave a useful receipt, even when the panel
// contains account data. Keep only the driver's fixed categories and counts.
import { evaluate } from './settings-panel-driver.mjs';

// Sample the same footer button and hit points as the trusted pointer driver.
// This is observation only: no click, notice dismissal, DOM text, or geometry
// leaves the page. Run it while the synthetic refusal is visible, after Retry,
// and immediately before the manual click to separate persistence from timing.
export async function observeSeoReauditHit(panel) {
  try {
    return await evaluate(
      panel,
      `(() => {
    const tabs = [...document.querySelectorAll('button[role="tab"][title="SEO"]')]
      .filter((button) => !button.closest('[role="tabpanel"]'));
    const tab = tabs.length === 1 ? tabs[0] : null;
    const pane = tab && document.getElementById(tab.getAttribute('aria-controls') ?? '');
    const active = tab?.getAttribute('aria-selected') === 'true' &&
      pane?.getAttribute('data-state') === 'active';
    const buttons = active ? [...pane.querySelectorAll('button')]
      .filter((button) => button.textContent.trim() === 'Re-audit') : [];
    const target = buttons.length === 1 ? buttons[0] : null;
    const notices = [...document.querySelectorAll('[role="alert"]')]
      .filter((alert) => alert.querySelector('.font-medium')?.textContent?.trim() ===
        'Saved audits unavailable' &&
        alert.querySelector('p')?.textContent?.includes(
          'the database refused the request because your account is not allowed'));
    if (!target) return { active: active === true, target_count: buttons.length,
      target_enabled: null, database_refused_notice_count: notices.length,
      hit_point_count: null, notice_hit_point_count: null };
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = target.getBoundingClientRect();
    const bounds = { left: Math.max(0, rect.left), top: Math.max(0, rect.top),
      right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) };
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
      const clips = (overflow) => /^(auto|scroll|hidden|clip)$/.test(overflow);
      if (clips(style.overflowX)) {
        bounds.left = Math.max(bounds.left, box.left + ancestor.clientLeft);
        bounds.right = Math.min(bounds.right, box.left + ancestor.clientLeft + ancestor.clientWidth);
      }
      if (clips(style.overflowY)) {
        bounds.top = Math.max(bounds.top, box.top + ancestor.clientTop);
        bounds.bottom = Math.min(bounds.bottom, box.top + ancestor.clientTop + ancestor.clientHeight);
      }
    }
    const points = [];
    if (bounds.right > bounds.left && bounds.bottom > bounds.top) {
      for (const fy of [0.5, 0.25, 0.75]) for (const fx of [0.5, 0.25, 0.75])
        points.push({ x: bounds.left + (bounds.right - bounds.left) * fx,
          y: bounds.top + (bounds.bottom - bounds.top) * fy });
    }
    const hits = points.map(({ x, y }) => document.elementFromPoint(x, y));
    return { active: active === true, target_count: buttons.length,
      target_enabled: !target.disabled, database_refused_notice_count: notices.length,
      hit_point_count: hits.filter((hit) => hit === target || target.contains(hit)).length,
      notice_hit_point_count: hits.filter((hit) => notices.some((notice) =>
        notice === hit || notice.contains(hit))).length };
  })()`,
    );
  } catch {
    return { sample_unavailable: true };
  }
}

const PHASES = new Set([
  'before_target_resolution',
  'target_selected',
  'press_attempted',
  'press_returned',
  'release_attempted',
  'release_returned',
]);
const POINTER_CODES = new Set([
  'pointer_initial_evaluation_failed',
  'pointer_page_sample_failed',
  'pointer_target_not_unique',
  'pointer_followup_evaluation_failed',
  'pointer_stable_hit_not_observed',
  'pointer_press_dispatch_failed',
  'pointer_release_dispatch_failed',
]);
const SAMPLE_STAGES = new Set([
  'target_resolution',
  'visibility_filter',
  'scroll_preparation',
  'clipping_geometry',
  'hit_testing',
  'animation_observation',
]);
const HIT_CATEGORIES = new Set([
  'none',
  'target',
  'dialog',
  'listbox',
  'modal_overlay',
  'target_ancestor',
  'header_or_tabs',
  'other_element',
]);
const OWNER_CATEGORIES = new Set(['none', 'seo', 'unmapped_tabpanel']);
const NOTICE_CATEGORIES = new Set([
  'none',
  'capture_no_workspace',
  'other_no_workspace',
  'database_refused',
  'database_missing_relation',
  'database_not_authenticated',
  'database_unreachable',
  'other_alert',
]);

function category(value, allowed) {
  return allowed.has(value) ? value : null;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : null;
}

function flag(value) {
  return typeof value === 'boolean' ? value : null;
}

export function captureSeoClickFailure(error, phase) {
  const receipt = {
    phase: category(phase, PHASES),
    source: POINTER_CODES.has(error?.driverFailure?.code) ? 'pointer_driver' : 'other_exception',
  };
  if (receipt.source !== 'pointer_driver') return receipt;
  const failure = error.driverFailure;
  const occluder = failure.centerOccluder;
  return {
    ...receipt,
    code: failure.code,
    sample_stage: category(failure.sampleStage, SAMPLE_STAGES),
    matched_target_count: count(failure.matchedTargetCount),
    visible_match_count: count(failure.visibleMatchCount),
    hit_target: flag(failure.hitTarget),
    stable_samples: count(failure.stableSamples),
    selected_point_available: flag(failure.selectedPointAvailable),
    center_hit_category: category(failure.centerHitCategory, HIT_CATEGORIES),
    center_occluder:
      occluder && typeof occluder === 'object'
        ? {
            owning_panel: category(occluder.owning_panel, OWNER_CATEGORIES),
            known_notice: category(occluder.known_notice, NOTICE_CATEGORIES),
          }
        : null,
  };
}

export async function clickSeoReaudit(panel, report, click) {
  report.click_phase = 'before_target_resolution';
  try {
    return await click(panel, 'button', 'Re-audit', (phase) => {
      report.click_phase = phase;
    });
  } catch (error) {
    report.click_failure_diagnostic = captureSeoClickFailure(error, report.click_phase);
    throw error;
  }
}
