import { isSafeDestination } from '@/lib/credentials/login-urls';

export interface CredentialFrameLink {
  frameId: number;
  parentFrameId: number;
  documentId: string;
  origin: string;
}
export interface CredentialFrameBinding {
  tabId: number;
  frameId: number;
  documentId: string;
  chain: CredentialFrameLink[];
}

const originOf = (raw: string): string | null => {
  try {
    const url = new URL(raw);
    return isSafeDestination(url) ? url.origin : null;
  } catch {
    return null;
  }
};

/** Read and freeze the exact selected-frame-to-top-frame ownership chain. */
export async function readCredentialFrameBinding(
  tabId: number,
  frameId: number,
  documentId: string,
): Promise<CredentialFrameBinding | null> {
  if (
    !Number.isInteger(tabId) ||
    tabId < 0 ||
    !Number.isInteger(frameId) ||
    frameId < 0 ||
    !documentId
  )
    return null;
  const chain: CredentialFrameLink[] = [];
  let current = frameId;
  const seen = new Set<number>();
  while (!seen.has(current)) {
    seen.add(current);
    let frame: { documentId?: unknown; url?: unknown; parentFrameId?: unknown } | null;
    try {
      frame = await chrome.webNavigation.getFrame({ tabId, frameId: current });
    } catch {
      return null;
    }
    if (
      !frame ||
      typeof frame.documentId !== 'string' ||
      typeof frame.url !== 'string' ||
      typeof frame.parentFrameId !== 'number' ||
      !Number.isInteger(frame.parentFrameId)
    )
      return null;
    const origin = originOf(frame.url);
    if (!origin) return null;
    try {
      if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) return null;
    } catch {
      return null;
    }
    chain.push({
      frameId: current,
      parentFrameId: frame.parentFrameId,
      documentId: frame.documentId,
      origin,
    });
    if (current === 0) break;
    if (frame.parentFrameId < 0) return null;
    current = frame.parentFrameId;
  }
  if (chain.at(-1)?.frameId !== 0 || chain[0]?.documentId !== documentId) return null;
  return { tabId, frameId, documentId, chain };
}

export async function credentialFrameBindingCurrent(
  binding: CredentialFrameBinding,
): Promise<boolean> {
  const current = await readCredentialFrameBinding(
    binding.tabId,
    binding.frameId,
    binding.documentId,
  );
  return !!current && JSON.stringify(current.chain) === JSON.stringify(binding.chain);
}
