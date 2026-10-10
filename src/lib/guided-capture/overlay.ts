/**
 * Guided capture — the small guide that appears on the target page.
 *
 * It exists only on a tab the web app sent here ("Take me there"); on any other
 * page of the same site it never draws. Shadow DOM, bottom-right, one card:
 * the steps, how many items have loaded, a Capture button, and — after — a way
 * back to the app. Read-only on the page: it counts and remembers what loads,
 * and sends nothing until the person presses Capture.
 */

import { DEFAULT_TIMEOUT_MS } from '@/lib/api/client';
import {
  type Accumulator,
  type CapturedImageRef,
  createAccumulator,
} from '@/lib/guided-capture/accumulator';
import {
  type GuidedState,
  INITIAL_GUIDED_STATE,
  canCapture,
  reduceGuided,
} from '@/lib/guided-capture/job';
import { nextSlideControl, scanPost, waitForSlide } from '@/lib/guided-capture/post';
import {
  GUIDED_PORT,
  type GuidedCapturePayload,
  type GuidedClientMsg,
  type GuidedHostMsg,
  type GuidedJobView,
} from '@/lib/guided-capture/protocol';
import {
  type GuidedRecipe,
  type GuidedTarget,
  countSentence,
  recipeForPlatform,
  recipeForUrl,
  stepsFor,
} from '@/lib/guided-capture/recipes';

const MAX_HTML_CHARS = 8_000_000;
const MAX_PAGE_IMAGES = 60;

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function pageImages(acc: Accumulator): CapturedImageRef[] {
  const out = new Map<string, CapturedImageRef>();
  for (const i of acc.images()) out.set(i.src, i);
  for (const img of Array.from(document.images)) {
    if (out.size >= MAX_PAGE_IMAGES + acc.count()) break;
    const src = img.currentSrc || img.src;
    if (!/^https?:/.test(src) || out.has(src)) continue;
    if (img.naturalWidth < 80 && img.width < 80) continue;
    out.set(src, {
      src,
      ...(img.alt ? { alt: img.alt.slice(0, 500) } : {}),
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    });
  }
  return [...out.values()];
}

export function readPage(
  acc: Accumulator,
  post?: { recipe: GuidedRecipe; url: string },
): GuidedCapturePayload {
  const observation = post ? scanPost(acc, post.recipe, post.url) : null;
  if (!post) scan(acc, null);
  let html = document.documentElement.outerHTML;
  if (html.length > MAX_HTML_CHARS) {
    html = html.replace(/<style[\s\S]*?<\/style>/gi, '').slice(0, MAX_HTML_CHARS);
  }
  return {
    finalUrl: location.href,
    title: document.title,
    text: document.body?.innerText ?? '',
    html,
    itemCount: acc.count(),
    images: post ? acc.images() : pageImages(acc),
    ...(post
      ? {
          videos: acc.videos(),
          mediaNotes: observation?.unavailableVideos
            ? ['Some videos are browser-only and could not be downloaded.']
            : [],
        }
      : {}),
  };
}

function scan(acc: Accumulator, recipe: GuidedRecipe | null): number {
  const r = recipe ?? recipeForUrl(location.href);
  if (!r) return acc.count();
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>(r.itemLinkSelector))) {
    const img = a.querySelector('img');
    acc.add({
      href: a.href,
      imgSrc: img?.currentSrc || img?.src || null,
      imgAlt: img?.alt || null,
      width: img?.naturalWidth || img?.width || null,
      height: img?.naturalHeight || img?.height || null,
    });
  }
  return acc.count();
}

export function mountGuidedOverlay(): void {
  const w = window as unknown as { __matrxGuided?: boolean };
  if (w.__matrxGuided) return;
  w.__matrxGuided = true;

  let port: chrome.runtime.Port | null = null;
  let job: GuidedJobView | null = null;
  let recipe: GuidedRecipe | null = null;
  let state: GuidedState = INITIAL_GUIDED_STATE;
  let acc: Accumulator | null = null;
  let host: HTMLDivElement | null = null;
  let root: ShadowRoot | null = null;
  let collapsed = false;
  let retriesLeft = 3;
  let reveal: AbortController | null = null;
  let revealNotice = '';
  let unavailableVideos = 0;
  let postAvailable = true;
  const postMode = () =>
    job?.target === 'post' && recipe && job ? { recipe, url: job.url } : undefined;
  function stopRevealing() {
    reveal?.abort();
    reveal = null;
  }
  async function revealSlides() {
    const post = postMode();
    if (!post || !acc || reveal) return;
    const controller = new AbortController();
    reveal = controller;
    const signatures = new Set<string>();
    revealNotice = 'Revealing slides…';
    render();
    try {
      while (!controller.signal.aborted) {
        const observation = scanPost(acc, post.recipe, post.url);
        if (!observation.root || !observation.signature || signatures.has(observation.signature))
          break;
        signatures.add(observation.signature);
        const next = nextSlideControl(observation.root);
        if (!next) break;
        next.click();
        const changed = await waitForSlide(
          () => scanPost(acc!, post.recipe, post.url),
          observation.signature,
          DEFAULT_TIMEOUT_MS,
          controller.signal,
        );
        if (!changed) break;
      }
    } finally {
      if (reveal === controller) {
        reveal = null;
        revealNotice = 'Swipe through any remaining slides, then Capture.';
        render();
      }
    }
  }

  function send(m: GuidedClientMsg) {
    try {
      if (!port) {
        port = chrome.runtime.connect({ name: GUIDED_PORT });
        port.onMessage.addListener(onHost);
        port.onDisconnect.addListener(() => {
          port = null;
        });
      }
      port.postMessage(m);
    } catch {
      if (job)
        dispatch({ type: 'failed', sentence: 'Matrx was updated. Reload this page to continue.' });
    }
  }

  function dispatch(event: Parameters<typeof reduceGuided>[1]) {
    state = reduceGuided(state, event);
    render();
  }

  function onHost(m: GuidedHostMsg) {
    if (m.t === 'job') {
      if (job) return;
      job = m.job;
      recipe = recipeForPlatform(m.job.platform) ?? recipeForUrl(location.href);
      acc = recipe ? createAccumulator(recipe) : null;
      startWatching();
      mount();
      render();
    } else if (m.t === 'none') {
      if (!job && retriesLeft-- > 0) setTimeout(() => send({ t: 'hello' }), 1800);
    } else if (m.t === 'filed') {
      dispatch({ type: 'filed', chars: m.chars, items: m.items, notice: m.notice });
    } else if (m.t === 'failed') {
      dispatch({ type: 'failed', sentence: m.sentence });
    }
  }

  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  function startWatching() {
    const run = () => {
      if (!acc) return;
      const post = postMode();
      if (post) {
        const observation = scanPost(acc, post.recipe, post.url);
        postAvailable = !!observation.root;
        unavailableVideos = observation.unavailableVideos;
        if (!postAvailable) stopRevealing();
        dispatch({ type: 'items', count: acc.count() });
        render();
      } else dispatch({ type: 'items', count: scan(acc, recipe) });
    };
    run();
    const obs = new MutationObserver(() => {
      if (scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        run();
      }, 400);
    });
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'poster', 'aria-label', 'aria-disabled', 'disabled'],
    });
    document.addEventListener('load', run, true);
    document.addEventListener('loadeddata', run, true);
  }

  function mount() {
    host = document.createElement('div');
    host.id = 'matrx-guided-capture';
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  .card{font:13px/1.4 system-ui,sans-serif;background:#111827;color:#f9fafb;border-radius:12px;
    box-shadow:0 6px 24px rgba(0,0,0,.4);padding:12px;width:268px;display:flex;flex-direction:column;gap:8px}
  .head{display:flex;justify-content:space-between;align-items:center;font-weight:600}
  .x{background:none;border:0;color:#9ca3af;cursor:pointer;font:inherit;padding:0 4px}
  ol{margin:0;padding-left:18px;color:#d1d5db}
  li{margin:2px 0} li.last{color:#f9fafb;font-weight:600}
  .count{font-size:12px;color:#93c5fd}
  .row{display:flex;gap:6px}
  button.b{flex:1;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:8px 10px;font:inherit;font-weight:600;cursor:pointer}
  button.b.alt{background:#374151}
  button.b:disabled{opacity:.55;cursor:default}
  .msg{font-size:12px;word-break:break-word}.ok{color:#86efac}.bad{color:#fca5a5}
  [hidden]{display:none!important}
</style>
<div class="card" part="card"></div>`;
    document.documentElement.appendChild(host);
    root.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
      if (id === 'reveal') {
        void revealSlides();
        return;
      }
      if (id === 'stop') {
        stopRevealing();
        revealNotice = 'Swipe through every slide, then Capture.';
        render();
        return;
      }
      if (id === 'capture' && canCapture(state) && acc && postAvailable) {
        stopRevealing();
        dispatch({ type: 'capture' });
        send({ t: 'capture', payload: readPage(acc, postMode()) });
      } else if (id === 'retry') dispatch({ type: 'retry' });
      else if (id === 'back') send({ t: 'back' });
      else if (id === 'close') {
        stopRevealing();
        send({ t: 'finish' });
        host?.remove();
      } else if (id === 'min') {
        collapsed = !collapsed;
        render();
      }
    });
  }

  function render() {
    const card = root?.querySelector('.card');
    if (!card || !job) return;
    const label = recipe?.label ?? 'this page';
    const post = postMode();
    const steps = post
      ? ['Open the saved post', 'Swipe through every image and video', 'Press Capture']
      : stepsFor(recipe, (job.target as GuidedTarget | null) ?? null, job.rowSteps);
    const count =
      post && acc
        ? `${acc.images().length} images · ${acc.videos().length} videos`
        : countSentence(recipe, state.itemCount);
    const head = `<div class="head"><span>Matrx · ${esc(label)}</span><button class="x" data-act="min" aria-label="${collapsed ? 'Expand guide' : 'Collapse guide'}">${collapsed ? '+' : '–'}</button></div>`;
    if (collapsed) {
      card.innerHTML = head + `<div class="count" role="status">${esc(count)}</div>`;
      return;
    }
    const list = `<ol>${steps.map((s, i) => `<li${i === steps.length - 1 ? ' class="last"' : ''}>${esc(s)}</li>`).join('')}</ol>`;
    let body: string;
    if (state.phase === 'done') {
      const n = state.filed?.items ?? 0;
      body = `<div class="msg ok" role="status">Captured${n ? ` ${esc(countSentence(recipe, n))}` : ''}. The results are waiting in Matrx.${state.filed?.notice ? ` ${esc(state.filed.notice)}` : ''}</div>
<div class="row"><button class="b" data-act="back">Back to Matrx</button><button class="b alt" data-act="close">Close</button></div>`;
    } else if (state.phase === 'failed') {
      body = `<div class="msg bad" role="alert">${esc(state.error ?? 'That did not save.')}</div>
<div class="row"><button class="b" data-act="retry">Try again</button><button class="b alt" data-act="close">Close</button></div>`;
    } else {
      const manual = post
        ? `<div class="msg" role="status">${esc(!postAvailable ? 'Open the saved post so its slides can be captured.' : revealNotice || 'Reveal slides automatically, or swipe through each one.')}</div>${unavailableVideos ? '<div class="msg bad">Some videos cannot be downloaded from this browser.</div>' : ''}<div class="row"><button class="b alt" data-act="${reveal ? 'stop' : 'reveal'}"${!postAvailable || state.phase === 'filing' ? ' disabled' : ''}>${reveal ? 'Stop' : 'Reveal slides'}</button></div>`
        : '';
      body = `${list}<div class="count" role="status" aria-live="polite">${esc(count)} found</div>${manual}
<div class="row"><button class="b" data-act="capture"${state.phase === 'filing' || !postAvailable || reveal ? ' disabled' : ''}>${state.phase === 'filing' ? 'Saving…' : 'Capture'}</button></div>`;
    }
    card.innerHTML = head + body;
  }

  send({ t: 'hello' });
}
