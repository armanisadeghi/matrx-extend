/**
 * Isolated-world, value-free identities for generated-password targets.
 *
 * `chrome.scripting.executeScript` runs in this extension's isolated world,
 * so a mounted content script and a later closure-free dispatcher can share
 * this registry without putting DOM references, selectors, or secrets on a
 * message boundary.  The caller still supplies Chrome's documentId on every
 * operation; a matching selector is deliberately not an identity.
 */
import { SENSITIVE_ATTR } from '@/lib/credentials/sensitive-fields';

export const GENERATED_SECRET_TTL_MS = 30_000;
export const REGISTERED_INPUT_TTL_MS = 60_000;
const MAX_REGISTERED_INPUTS = 16;

export interface GenerationTargetRegistry {
  register(input: HTMLInputElement, group: Element, documentId: string, expiresAt: number): string | null;
  resolve(id: string, documentId: string, expiresAt: number): HTMLInputElement | null;
  registerInput(input: HTMLInputElement): string | null;
  resolveInput(id: string, documentId: string): HTMLInputElement | null;
  isRegisteredInput(id: string, input: HTMLInputElement): boolean;
  belongsTo(id: string, input: HTMLInputElement, group: Element): boolean;
  bindGroup(ids: readonly string[]): boolean;
  claim(ids: readonly string[], documentId: string, expiresAt: number): boolean;
  markSensitive(input: HTMLInputElement): boolean;
  isSensitive(element: Element): boolean;
  invalidate(ids?: readonly string[]): void;
}

declare global {
  interface Window {
    __matrx_generation_target_registry__?: GenerationTargetRegistry;
  }
}

function opaqueId(): string | null {
  try {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** Mount once per isolated-world document. Safe to call from content bridge re-entry. */
export function mountGenerationTargetRegistry(): GenerationTargetRegistry {
  if (window.__matrx_generation_target_registry__) return window.__matrx_generation_target_registry__;

  const documentRef = document;
  // Generated-secret redaction is document-lifetime identity memory. Offers
  // expire, but a page may later expose the same filled node as text.
  const sensitiveInputs = new WeakSet<Element>();
  const entries = new Map<
    string,
    { node: WeakRef<HTMLInputElement>; group: WeakRef<Element>; hosts: Array<{ host: WeakRef<Element>; parent: WeakRef<Node>; root: WeakRef<Node> }>; documentId: string; expiresAt: number; claimed: boolean; members: string[] | null }
  >();
  const inputs = new Map<
    string,
    { node: WeakRef<HTMLInputElement>; hosts: Array<{ host: WeakRef<Element>; parent: WeakRef<Node>; root: WeakRef<Node> }>; root: WeakRef<Node>; documentId: string | null; expiresAt: number }
  >();
  const hostsFor = (input: HTMLInputElement): Array<{ host: WeakRef<Element>; parent: WeakRef<Node>; root: WeakRef<Node> }> => {
    const hosts: Array<{ host: WeakRef<Element>; parent: WeakRef<Node>; root: WeakRef<Node> }> = [];
    let root: Node = input.getRootNode();
    while (root instanceof ShadowRoot) {
      const host = root.host;
      const parent = host.parentNode;
      const outerRoot = host.getRootNode();
      if (!parent) return [];
      hosts.unshift({ host: new WeakRef(host), parent: new WeakRef(parent), root: new WeakRef(outerRoot) });
      root = outerRoot;
    }
    return hosts;
  };
  const sameHosts = (input: HTMLInputElement, expected: Array<{ host: WeakRef<Element>; parent: WeakRef<Node>; root: WeakRef<Node> }>) => {
    const hosts = hostsFor(input);
    return hosts.length === expected.length && hosts.every((placement, index) => {
      const saved = expected[index];
      return !!saved && saved.host.deref() === placement.host.deref() && saved.parent.deref() === placement.parent.deref() && saved.root.deref() === placement.root.deref();
    });
  };
  const purge = () => {
    const now = Date.now();
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= now || entry.node.deref() === undefined || entry.group.deref() === undefined) entries.delete(id);
    }
    for (const [id, entry] of inputs) {
      const input = entry.node.deref();
      if (entry.expiresAt <= now || !input || !input.isConnected || input.ownerDocument !== documentRef || input.getRootNode() !== entry.root.deref() || !sameHosts(input, entry.hosts)) inputs.delete(id);
    }
  };
  const registry: GenerationTargetRegistry = {
    register(input, group, documentId, expiresAt) {
      purge();
      if (
        input.ownerDocument !== documentRef || group.ownerDocument !== documentRef || !group.isConnected ||
        !input.isConnected ||
        !documentId ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now() || expiresAt - Date.now() > GENERATED_SECRET_TTL_MS
      )
        return null;
      const id = opaqueId();
      if (!id) return null;
      const hosts = hostsFor(input);
      entries.set(id, { node: new WeakRef(input), group: new WeakRef(group), hosts, documentId, expiresAt, claimed: false, members: null });
      // Expiry is an active cleanup guarantee, not merely a later lookup check.
      window.setTimeout(() => {
        const entry = entries.get(id);
        if (entry?.expiresAt === expiresAt && entry.expiresAt <= Date.now()) entries.delete(id);
      }, Math.max(0, expiresAt - Date.now()));
      return id;
    },
    registerInput(input) {
      purge();
      if (input.ownerDocument !== documentRef || !input.isConnected) return null;
      let root: Node = input.getRootNode();
      while (root instanceof ShadowRoot) {
        if (root.mode !== 'open') return null;
        root = root.host.getRootNode();
      }
      for (const [id, entry] of inputs) {
        if (entry.node.deref() === input && input.getRootNode() === entry.root.deref() && sameHosts(input, entry.hosts)) return id;
      }
      if (inputs.size >= MAX_REGISTERED_INPUTS) return null;
      const id = opaqueId();
      if (!id) return null;
      const expiresAt = Date.now() + REGISTERED_INPUT_TTL_MS;
      inputs.set(id, { node: new WeakRef(input), hosts: hostsFor(input), root: new WeakRef(input.getRootNode()), documentId: null, expiresAt });
      window.setTimeout(() => { const entry = inputs.get(id); if (entry?.expiresAt === expiresAt && entry.expiresAt <= Date.now()) inputs.delete(id); }, REGISTERED_INPUT_TTL_MS);
      return id;
    },
    resolveInput(id, documentId) {
      purge();
      const entry = inputs.get(id);
      const input = entry?.node.deref() ?? null;
      if (!entry || !input || !documentId || input.ownerDocument !== documentRef || !input.isConnected || input.getRootNode() !== entry.root.deref() || !sameHosts(input, entry.hosts) || (entry.documentId !== null && entry.documentId !== documentId)) return null;
      entry.documentId = documentId;
      return input;
    },
    isRegisteredInput(id, input) {
      purge();
      const entry = inputs.get(id);
      return !!entry && entry.node.deref() === input && input.isConnected && input.getRootNode() === entry.root.deref() && sameHosts(input, entry.hosts);
    },
    resolve(id, documentId, expiresAt) {
      purge();
      const entry = entries.get(id);
      const input = entry?.node.deref() ?? null;
      if (
        !entry ||
        entry.documentId !== documentId ||
        entry.expiresAt !== expiresAt ||
        expiresAt <= Date.now() ||
        !input ||
        input.ownerDocument !== documentRef ||
        !input.isConnected
      )
        return null;
      return input;
    },
    belongsTo(id, input, group) {
      const entry = entries.get(id);
      return !!entry && entry.node.deref() === input && entry.group.deref() === group && sameHosts(input, entry.hosts);
    },
    bindGroup(ids) {
      if (ids.length === 0 || new Set(ids).size !== ids.length) return false;
      const selected = ids.map((id) => entries.get(id));
      if (selected.some((entry) => !entry || entry.members || entry.claimed)) return false;
      for (const entry of selected) entry!.members = [...ids];
      return true;
    },
    claim(ids, documentId, expiresAt) {
      purge();
      if (ids.length === 0 || new Set(ids).size !== ids.length) return false;
      const selected = ids.map((id) => entries.get(id));
      if (selected.some((entry) => !entry || entry.claimed || entry.documentId !== documentId || entry.expiresAt !== expiresAt || !entry.members || entry.members.length !== ids.length || entry.members.some((id, index) => id !== ids[index]))) return false;
      for (const entry of selected) entry!.claimed = true;
      return true;
    },
    markSensitive(input) {
      if (input.ownerDocument !== documentRef || !input.isConnected) return false;
      try {
        sensitiveInputs.add(input);
        input.setAttribute(SENSITIVE_ATTR, '');
        return true;
      } catch {
        return false;
      }
    },
    isSensitive(element) {
      return element.ownerDocument === documentRef && sensitiveInputs.has(element);
    },
    invalidate(ids) {
      if (!ids) {
        entries.clear();
        inputs.clear();
        return;
      }
      for (const id of ids) entries.delete(id);
    },
  };
  window.__matrx_generation_target_registry__ = registry;
  return registry;
}
