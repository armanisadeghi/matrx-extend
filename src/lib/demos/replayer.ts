/**
 * Replay engine for saved demos.
 *
 * Strategy:
 *   - Open `start_url` in the chosen tab (defaults to active).
 *   - Walk steps in order, resolving each step's selector_chain via the
 *     in-page resolver (same algorithm as selector.ts, duplicated inline
 *     so it can cross the chrome.scripting boundary).
 *   - Apply the action; await small post-step settle (DOM idle).
 *   - On any step failure, abort with a structured per-step report.
 *
 * Self-healing: the selector_chain ordering already provides resilience
 * (matrx-ref → id → testid → aria → text → css-path). LLM-based
 * recovery is a follow-up; the result envelope is shaped to allow for
 * it (failed_at_index lets a caller decide to ask the model to repair).
 *
 * 📝 Notes:
 *    .research/demo-system-design-notes.md
 */
import { log } from '@/lib/debug/log';
import type {
  Demo,
  DemoStep,
  ReplayResult,
  ReplayStepResult,
  SelectorStrategy,
} from '@/lib/demos/types';

export interface ReplayOptions {
  demo: Demo;
  /** Tab to replay in. Defaults to active tab. */
  tabId?: number;
  /** Substitution map for `param_placeholder`s. */
  params?: Record<string, string>;
  /** Skip waits / no-op actions if true. */
  dry_run?: boolean;
}

const SETTLE_MS = 250;
const NAV_TIMEOUT_MS = 15_000;

export async function replayDemo(opts: ReplayOptions): Promise<ReplayResult> {
  const startedAt = Date.now();
  const params = opts.params ?? {};
  const stepResults: ReplayStepResult[] = [];

  let tabId = opts.tabId;
  if (tabId == null) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return finalize(opts.demo, stepResults, startedAt, false, 0, 'No active tab');
    }
    tabId = tab.id;
  }

  // Ensure the tab is on the demo's start URL.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url !== opts.demo.start_url) {
      await navigateAndWait(tabId, opts.demo.start_url);
    } else {
      // Already there; reload to ensure clean state.
      await chrome.tabs.reload(tabId);
      await waitForLoad(tabId);
    }
  } catch (err) {
    return finalize(
      opts.demo,
      stepResults,
      startedAt,
      false,
      0,
      `Tab navigation failed: ${(err as Error).message}`,
    );
  }

  for (const step of opts.demo.steps) {
    const stepStart = Date.now();
    if (step.kind === 'navigate' && step.index === 0) {
      // Already navigated above.
      stepResults.push({
        step_id: step.id,
        index: step.index,
        kind: step.kind,
        ok: true,
        elapsed_ms: 0,
      });
      continue;
    }

    if (step.kind === 'navigate' && step.navigation_url) {
      try {
        await navigateAndWait(tabId, step.navigation_url);
        stepResults.push({
          step_id: step.id,
          index: step.index,
          kind: step.kind,
          ok: true,
          elapsed_ms: Date.now() - stepStart,
        });
      } catch (err) {
        stepResults.push({
          step_id: step.id,
          index: step.index,
          kind: step.kind,
          ok: false,
          error: (err as Error).message,
          elapsed_ms: Date.now() - stepStart,
        });
        return finalize(
          opts.demo,
          stepResults,
          startedAt,
          false,
          step.index,
          (err as Error).message,
        );
      }
      continue;
    }

    if (step.kind === 'scroll') {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (x: number, y: number) => window.scrollTo(x, y),
          args: [step.scroll_target?.x ?? 0, step.scroll_target?.y ?? 0],
        });
        stepResults.push({
          step_id: step.id,
          index: step.index,
          kind: step.kind,
          ok: true,
          elapsed_ms: Date.now() - stepStart,
        });
      } catch (err) {
        stepResults.push({
          step_id: step.id,
          index: step.index,
          kind: step.kind,
          ok: false,
          error: (err as Error).message,
          elapsed_ms: Date.now() - stepStart,
        });
      }
      continue;
    }

    // All remaining kinds need to resolve the selector chain in-page.
    const inputValue = resolveStepInput(step, params);
    const result = await applyStep(tabId, step, inputValue, opts.dry_run ?? false);
    stepResults.push({
      step_id: step.id,
      index: step.index,
      kind: step.kind,
      ok: result.ok,
      resolved_via: result.resolved_via,
      error: result.error,
      elapsed_ms: Date.now() - stepStart,
    });
    if (!result.ok) {
      return finalize(
        opts.demo,
        stepResults,
        startedAt,
        false,
        step.index,
        result.error ?? 'step failed',
      );
    }
    await sleep(SETTLE_MS);
  }

  return finalize(opts.demo, stepResults, startedAt, true);
}

function resolveStepInput(step: DemoStep, params: Record<string, string>): string | null {
  if (step.kind === 'type' || step.kind === 'select' || step.kind === 'press_key') {
    if (step.param_placeholder && params[step.param_placeholder] !== undefined) {
      return params[step.param_placeholder] as string;
    }
    if (step.is_sensitive && !step.param_placeholder) return null;
    return step.input_text ?? '';
  }
  return null;
}

interface ApplyResult {
  ok: boolean;
  resolved_via?: SelectorStrategy['kind'];
  error?: string;
}

async function applyStep(
  tabId: number,
  step: DemoStep,
  inputValue: string | null,
  dryRun: boolean,
): Promise<ApplyResult> {
  if (step.is_sensitive && step.param_placeholder && inputValue == null) {
    return { ok: false, error: `Missing required parameter: ${step.param_placeholder}` };
  }
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: applyStepInPage,
      args: [
        step.kind,
        step.selector_chain as unknown as Array<{
          kind: string;
          selector: string;
          match_text?: string;
          role?: string;
        }>,
        inputValue,
        step.checked ?? null,
        dryRun,
      ],
    });
    const r = first?.result as ApplyResult | undefined;
    return r ?? { ok: false, error: 'no result from in-page step' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Inline applier — runs in the page context. Self-contained; no imports.
 */
function applyStepInPage(
  kind: string,
  chain: Array<{ kind: string; selector: string; match_text?: string; role?: string }>,
  inputValue: string | null,
  checked: boolean | null,
  dryRun: boolean,
): { ok: boolean; resolved_via?: string; error?: string } {
  function resolveOne(strat: {
    kind: string;
    selector: string;
    match_text?: string;
  }): Element | null {
    if (strat.kind === 'aria') {
      const all = Array.from(document.querySelectorAll(strat.selector));
      const want = (strat.match_text ?? '').toLowerCase();
      return (
        all.find(
          (el) =>
            (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().toLowerCase() === want,
        ) ?? null
      );
    }
    if (strat.kind === 'text') {
      const all = Array.from(document.querySelectorAll<HTMLElement>(strat.selector));
      const want = (strat.match_text ?? '').toLowerCase();
      return all.find((el) => (el.textContent ?? '').trim().toLowerCase() === want) ?? null;
    }
    try {
      return document.querySelector(strat.selector);
    } catch {
      return null;
    }
  }
  function isInteractable(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return true;
    if (el.hidden) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  let target: Element | null = null;
  let resolvedKind = '';
  for (const strat of chain) {
    const el = resolveOne(strat);
    if (el && isInteractable(el)) {
      target = el;
      resolvedKind = strat.kind;
      break;
    }
  }
  if (!target)
    return { ok: false, error: `Could not resolve element via any of ${chain.length} strategies` };

  if (dryRun) return { ok: true, resolved_via: resolvedKind };

  try {
    if (kind === 'click') {
      (target as HTMLElement).scrollIntoView({ block: 'center' });
      (target as HTMLElement).click();
      return { ok: true, resolved_via: resolvedKind };
    }
    if (kind === 'type') {
      const t = target as HTMLInputElement | HTMLTextAreaElement;
      t.focus();
      const setter = Object.getOwnPropertyDescriptor(
        t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value',
      )?.set;
      if (setter) setter.call(t, inputValue ?? '');
      else t.value = inputValue ?? '';
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, resolved_via: resolvedKind };
    }
    if (kind === 'select') {
      const sel = target as HTMLSelectElement;
      sel.value = inputValue ?? '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, resolved_via: resolvedKind };
    }
    if (kind === 'check') {
      const inp = target as HTMLInputElement;
      if (checked != null && inp.checked !== checked) inp.click();
      return { ok: true, resolved_via: resolvedKind };
    }
    if (kind === 'submit') {
      (target as HTMLFormElement).requestSubmit?.();
      if (!(target as HTMLFormElement).requestSubmit) (target as HTMLFormElement).submit();
      return { ok: true, resolved_via: resolvedKind };
    }
    if (kind === 'press_key') {
      const combo = inputValue ?? '';
      const parts = combo.split('+');
      const key = parts[parts.length - 1] ?? '';
      const ev = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ctrlKey: parts.includes('Ctrl'),
        metaKey: parts.includes('Meta'),
        altKey: parts.includes('Alt'),
        shiftKey: parts.includes('Shift'),
      });
      target.dispatchEvent(ev);
      return { ok: true, resolved_via: resolvedKind };
    }
    return { ok: false, error: `Unknown step kind: ${kind}`, resolved_via: resolvedKind };
  } catch (err) {
    return { ok: false, error: (err as Error).message, resolved_via: resolvedKind };
  }
}

async function navigateAndWait(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url });
  await waitForLoad(tabId);
}

function waitForLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab ${tabId} did not finish loading within ${NAV_TIMEOUT_MS}ms`));
    }, NAV_TIMEOUT_MS);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id !== tabId) return;
      if (info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        // Tiny extra settle for SPAs that finish "complete" before hydration.
        setTimeout(resolve, SETTLE_MS);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function finalize(
  demo: Demo,
  stepResults: ReplayStepResult[],
  startedAt: number,
  ok: boolean,
  failedAtIndex?: number,
  reason?: string,
): ReplayResult {
  const result: ReplayResult = {
    ok,
    demo_id: demo.id,
    steps_attempted: stepResults.length,
    steps_succeeded: stepResults.filter((s) => s.ok).length,
    step_results: stepResults,
    duration_ms: Date.now() - startedAt,
  };
  if (!ok) {
    result.failed_at_index = failedAtIndex;
  }
  if (!ok && reason) log.warn('sw', `demo replay failed: ${reason}`);
  return result;
}
