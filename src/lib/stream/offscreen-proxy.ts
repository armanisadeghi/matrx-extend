/**
 * SW-side orchestrator. Sidepanel sends STREAM_START to the SW, the SW
 * ensures the offscreen document exists and forwards via STREAM_RUN
 * (NOT STREAM_START — that channel is sidepanel-only, otherwise we'd echo
 * our own broadcast and recurse forever).
 */

import { getApiBaseUrl, readSessionBearer } from '@/lib/api/client';
import { getAccessToken } from '@/lib/auth/flow';
import { getOrCreateGuestSignature } from '@/lib/auth/guest-signature';
import { log } from '@/lib/debug/log';
import { send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { getActiveOrganizationId, requireActiveOrganizationId } from '@/lib/org/active-org';
import { markStreamActive, markStreamInactive } from '@/lib/stream/active-runs';

const OFFSCREEN_PATH = 'offscreen.html';

let creating: Promise<void> | null = null;

export async function ensureOffscreen(): Promise<void> {
  // Check the realm-local creation barrier BEFORE asking Chrome whether a
  // context exists. Chrome can expose the new OFFSCREEN_DOCUMENT while its
  // createDocument promise is still in flight; treating that half-created
  // context as ready lets a concurrent WS/audio/stream caller send before the
  // document has registered its listeners (`ws:start — no listener`).
  if (creating) return creating;
  // Install the barrier synchronously, before the first async existence
  // check. Otherwise two callers can both enter while getContexts() is in
  // flight, both observe no document, and both call createDocument().
  creating = createOffscreenIfMissing().finally(() => {
    creating = null;
  });
  return creating;
}

async function createOffscreenIfMissing(): Promise<void> {
  if (await offscreenExists()) {
    log.info('stream', 'offscreen already exists');
    return;
  }
  log.info('stream', 'creating offscreen document');
  // USER_MEDIA is required for getUserMedia from the offscreen doc — voice
  // input (TASK-002) won't work without it. BLOBS is for the SSE / scrape
  // pipeline. Multiple reasons are allowed in a single offscreen doc.
  await chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['BLOBS', 'USER_MEDIA'] as chrome.offscreen.Reason[],
      justification:
        'Holds long-running fetch ReadableStreams for AI streams; also captures microphone audio for voice input (side-panel getUserMedia is unreliable in MV3).',
    })
    .then(() => {
      log.success('stream', 'offscreen document created');
    })
    .catch((err) => {
      if (/Only a single offscreen/i.test((err as Error).message)) {
        log.info('stream', 'offscreen race — already exists');
        return;
      }
      log.error('stream', 'offscreen creation failed', err);
      throw err;
    });
}

async function offscreenExists(): Promise<boolean> {
  if (chrome.runtime.getContexts) {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
      });
      return contexts.length > 0;
    } catch {
      /* fall through */
    }
  }
  if ('hasDocument' in chrome.offscreen) {
    return await (chrome.offscreen as { hasDocument: () => Promise<boolean> }).hasDocument();
  }
  return false;
}

export interface StartStreamArgs {
  runId: string;
  endpoint: string;
  body?: unknown;
  parser: 'text-chunks' | 'rich-events';
  /** Optional agent name (for log attribution + UI on the offscreen → SW path). */
  agentName?: string | null;
  /** Permission mode for any client tools the agent runs in this stream. */
  permissionMode?: 'ask' | 'act';
  /**
   * Tab the agent is pinned to for this run. Captured at message-send time
   * so tools don't drift onto whatever tab the user happens to focus during
   * execution. Null when the run isn't tied to a specific page (e.g. an
   * agenda task where the agent navigates itself).
   */
  assignedTabId?: number | null;
}

/**
 * Payload actually sent to the offscreen — pre-resolved URL + headers so
 * offscreen never needs to call chrome.storage or rerun auth logic.
 */
export interface StreamRunPayload {
  runId: string;
  url: string;
  body?: unknown;
  parser: 'text-chunks' | 'rich-events';
  headers: Record<string, string>;
  agentName?: string | null;
  permissionMode?: 'ask' | 'act';
}

function isConversationStartBody(body: unknown): body is Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const candidate = body as Record<string, unknown>;
  return (
    typeof candidate.conversation_id === 'string' &&
    typeof candidate.is_new === 'boolean' &&
    typeof candidate.store === 'boolean'
  );
}

/**
 * Bind a conversation start's body to the exact actor used for its headers.
 *
 * The side panel may assemble its payload before the service worker wakes.
 * It must never independently infer whether the actor is a bearer or guest:
 * a token transition between those reads could put a guest-shaped body behind
 * a bearer header, or a bearer tenant assertion behind a fingerprint header.
 * The SW reads the actor once and writes both parts of this request envelope.
 */
export function bindConversationStartActor(body: unknown, organizationId: string | null): unknown {
  if (!isConversationStartBody(body)) return body;
  const { organization_id: _untrustedOrganizationId, ...rest } = body;
  return organizationId === null ? rest : { ...rest, organization_id: organizationId };
}

interface StreamActor {
  token: string | null;
  organizationId: string | null;
}

async function resolveStableStreamActor(): Promise<StreamActor> {
  // Organization selection can wait for a person. Recheck both authority
  // halves after that wait, then retry once from a fresh snapshot. Dispatching
  // an old bearer with a newly chosen organization is a cross-actor request.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await readSessionBearer();
    if (!token) {
      const tokenAtDispatch = await getAccessToken();
      if (!tokenAtDispatch) return { token: null, organizationId: null };
      continue;
    }
    const organizationId = await requireActiveOrganizationId();
    const [tokenAtDispatch, organizationAtDispatch] = await Promise.all([
      getAccessToken(),
      getActiveOrganizationId(),
    ]);
    if (tokenAtDispatch === token && organizationAtDispatch === organizationId) {
      return { token, organizationId };
    }
  }
  throw new Error(
    'Your sign-in or workspace changed while this request was preparing. Please try again.',
  );
}

async function streamActorStillCurrent(actor: StreamActor): Promise<boolean> {
  if (actor.token === null) return (await getAccessToken()) === null;
  const [token, organizationId] = await Promise.all([getAccessToken(), getActiveOrganizationId()]);
  return token === actor.token && organizationId === actor.organizationId;
}

export async function startStream(args: StartStreamArgs): Promise<void> {
  log.info('stream', `start ${args.runId} → ${args.endpoint}`);
  // Resolve the URL + access token in the SW (where storage works reliably)
  // and ship the full request envelope to offscreen. Offscreen just executes.
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}${args.endpoint}`;
  // A stream is a request too: the SAME session-bearer rule as every REST
  // call. A signed-in install whose bearer is not readable yet waits for it
  // and is then REFUSED (`SessionNotReadyError`, surfaced by the caller's
  // stream error path) — never started as a guest, which is how a run would
  // die on the server's 401 and read to the person as a broken agent
  // (2026-09-19, sibling of the REST guest-downgrade defect).
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actor = await resolveStableStreamActor();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    let body = args.body;
    if (actor.token) {
      headers.Authorization = `Bearer ${actor.token}`;
      // A stream is a request too. It carries the organization or it does not
      // start — a run that opens without one dies mid-flight on the server's
      // admission gate, which reads to the user as a hang. With nothing set on
      // this device the start HOLDS while the person is asked, then proceeds
      // with what they chose (src/lib/org/active-org.ts).
      const organizationId = actor.organizationId;
      if (organizationId === null)
        throw new Error('Authenticated stream actor is missing an organization.');
      headers['X-Organization-Id'] = organizationId;
      body = bindConversationStartActor(body, organizationId);
    } else {
      // Nobody is signed in on this install (see readSessionBearer).
      headers['X-Fingerprint-ID'] = await getOrCreateGuestSignature();
      body = bindConversationStartActor(body, null);
    }

    await ensureOffscreen();

    const payload: StreamRunPayload = {
      runId: args.runId,
      url,
      ...(body !== undefined ? { body } : {}),
      parser: args.parser,
      headers,
      agentName: args.agentName ?? null,
      ...(args.permissionMode !== undefined ? { permissionMode: args.permissionMode } : {}),
    };
    // Mark the run live BEFORE handing it to the offscreen doc so a SW reap +
    // rewake during the stream can't have boot close the document under it
    // (see closeStaleOffscreenOnBoot). Cleared on the terminal done chunk by
    // the dispatcher's STREAM_CHUNK listener, on explicit cancel below, and
    // by age-out.
    await markStreamActive(args.runId);

    // `ensureOffscreen`, fingerprint creation, and the durable active-run
    // marker all await. Recheck immediately before the only irreversible
    // operation: sending this envelope into the stream transport.
    if (!(await streamActorStillCurrent(actor))) {
      // The retry reuses runId. Finish removing the abandoned attempt before
      // it can mark the replacement active, or the late removal loses it.
      await markStreamInactive(args.runId);
      continue;
    }

    // Use STREAM_RUN, not STREAM_START — distinct channel so this doesn't
    // recurse into the SW's own STREAM_START handler.
    await send(CHANNELS.STREAM_RUN, payload);
    return;
  }
  throw new Error(
    'Your sign-in or workspace changed while this request was preparing. Please try again.',
  );
}

export async function cancelStream(runId: string): Promise<void> {
  log.info('stream', `cancel ${runId}`);
  await send(CHANNELS.STREAM_KILL, { runId });
  void markStreamInactive(runId);
}
