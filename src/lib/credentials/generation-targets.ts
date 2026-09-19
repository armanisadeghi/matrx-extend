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

export interface GenerationTargetRegistry {
  register(input: HTMLInputElement, group: Element, documentId: string, expiresAt: number): string | null;
  resolve(id: string, documentId: string, expiresAt: number): HTMLInputElement | null;
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
    { node: WeakRef<HTMLInputElement>; group: WeakRef<Element>; hosts: WeakRef<Element>[]; documentId: string; expiresAt: number; claimed: boolean; members: string[] | null }
  >();
  const purge = () => {
    const now = Date.now();
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= now || entry.node.deref() === undefined || entry.group.deref() === undefined) entries.delete(id);
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
      const hosts: WeakRef<Element>[] = [];
      let root: Node = input.getRootNode();
      while (root instanceof ShadowRoot) { hosts.unshift(new WeakRef(root.host)); root = root.host.getRootNode(); }
      entries.set(id, { node: new WeakRef(input), group: new WeakRef(group), hosts, documentId, expiresAt, claimed: false, members: null });
      // Expiry is an active cleanup guarantee, not merely a later lookup check.
      window.setTimeout(() => {
        const entry = entries.get(id);
        if (entry?.expiresAt === expiresAt && entry.expiresAt <= Date.now()) entries.delete(id);
      }, Math.max(0, expiresAt - Date.now()));
      return id;
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
      if (entry?.node.deref() !== input || entry.group.deref() !== group) return false;
      const hosts: Element[] = [];
      let root: Node = input.getRootNode();
      while (root instanceof ShadowRoot) { hosts.unshift(root.host); root = root.host.getRootNode(); }
      return hosts.length === entry.hosts.length && hosts.every((host, index) => entry.hosts[index]?.deref() === host);
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
        return;
      }
      for (const id of ids) entries.delete(id);
    },
  };
  window.__matrx_generation_target_registry__ = registry;
  return registry;
}
