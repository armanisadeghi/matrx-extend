/** Shared DOM access for serialized browser tools, including nested open shadow roots. */
interface ToolDomAccess {
  roots: () => Array<Document | ShadowRoot>;
  querySelectorAll: (selector: string) => Element[];
  querySelector: (selector: string) => Element | null;
  parent: (element: Element) => Element | null;
  selector: (element: Element) => string;
  elementFromPoint: (x: number, y: number) => Element | null;
  visible: (element: Element, requireBounds?: boolean) => boolean;
  activeElement: () => Element | null;
  shadowHosts: (element: Element) => Array<{ tag: string; id: string | null }>;
}

declare global {
  interface Window {
    __matrxToolDom: ToolDomAccess;
  }
}

/** Injected into Chrome's isolated world; deliberately has no module dependencies. */
function installToolDom(): void {
  function roots(): Array<Document | ShadowRoot> {
    const out: Array<Document | ShadowRoot> = [document];
    for (let i = 0; i < out.length; i++) {
      for (const el of out[i]!.querySelectorAll('*')) {
        if (el.shadowRoot) out.push(el.shadowRoot);
      }
    }
    return out;
  }
  function querySelectorAll(selector: string): Element[] {
    // Search selectors from find_text_on_page through their exact host chain.
    // Ordinary CSS is evaluated independently in each open root.
    const parts: string[] = [];
    let start = 0;
    let bracketDepth = 0;
    let quote = '';
    for (let i = 0; i < selector.length; i++) {
      const char = selector[i];
      if (char === '\\') {
        i++;
        continue;
      }
      if (quote) {
        if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '[' || char === '(') bracketDepth++;
      if (char === ']' || char === ')') bracketDepth--;
      if (!bracketDepth && selector.slice(i, i + 5) === ' >>> ') {
        parts.push(selector.slice(start, i).trim());
        start = i + 5;
        i += 4;
      }
    }
    parts.push(selector.slice(start).trim());
    if (parts.length > 1) {
      let scopes: Array<Document | ShadowRoot> = [document];
      for (let i = 0; i < parts.length; i++) {
        const matches = scopes.flatMap((scope) => Array.from(scope.querySelectorAll(parts[i]!)));
        if (i === parts.length - 1) return matches;
        scopes = matches.flatMap((el) => (el.shadowRoot ? [el.shadowRoot] : []));
      }
      return [];
    }
    return roots().flatMap((root) => Array.from(root.querySelectorAll(selector)));
  }
  function parent(el: Element): Element | null {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }
  function selector(el: Element): string {
    function withinRoot(element: Element): string {
      const parts: string[] = [];
      let node: Element | null = element;
      while (node) {
        if (node.id) {
          parts.unshift(`#${CSS.escape(node.id)}`);
          break;
        }
        const tag = node.tagName.toLowerCase();
        const siblings = Array.from(node.parentNode?.children ?? []).filter(
          (sibling) => sibling.tagName === node!.tagName,
        );
        parts.unshift(
          siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag,
        );
        node = node.parentElement;
      }
      return parts.join(' > ');
    }
    const local = withinRoot(el);
    const root = el.getRootNode();
    return root instanceof ShadowRoot ? `${selector(root.host)} >>> ${local}` : local;
  }
  function elementFromPoint(x: number, y: number): Element | null {
    let el = document.elementFromPoint(x, y);
    while (el?.shadowRoot) {
      const nested = el.shadowRoot.elementFromPoint?.(x, y);
      if (!nested || nested === el) break;
      el = nested;
    }
    return el;
  }
  function activeElement(): Element | null {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }
  function shadowHosts(el: Element): Array<{ tag: string; id: string | null }> {
    const hosts: Array<{ tag: string; id: string | null }> = [];
    let root = el.getRootNode();
    while (root instanceof ShadowRoot) {
      hosts.unshift({ tag: root.host.tagName.toLowerCase(), id: root.host.id || null });
      root = root.host.getRootNode();
    }
    return hosts;
  }
  function visible(el: Element, requireBounds = true): boolean {
    const rect = el.getBoundingClientRect();
    if (requireBounds && rect.width === 0 && rect.height === 0) return false;
    for (let node: Element | null = el; node; node = parent(node)) {
      const style = window.getComputedStyle(node);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        Number.parseFloat(style.opacity || '1') === 0
      )
        return false;
    }
    return true;
  }
  window.__matrxToolDom = {
    roots,
    querySelectorAll,
    querySelector: (selector) => querySelectorAll(selector)[0] ?? null,
    parent,
    selector,
    elementFromPoint,
    visible,
    activeElement,
    shadowHosts,
  };
}

/**
 * Chrome serializes func without imports/closures. Install the shared helper in
 * the same target and isolated world first, then execute the original probe.
 * Installation is repeated so navigation and newly inserted shadow roots work.
 */
export async function executeDomScript<Args extends unknown[], Result>(
  injection: chrome.scripting.ScriptInjection<Args, Result>,
): Promise<chrome.scripting.InjectionResult<chrome.scripting.Awaited<Result>>[]> {
  await chrome.scripting.executeScript({
    target: injection.target,
    ...(injection.world !== undefined && { world: injection.world }),
    func: installToolDom,
  });
  return chrome.scripting.executeScript(injection);
}
