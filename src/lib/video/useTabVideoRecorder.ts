/**
 * useTabVideoRecorder
 *
 * Hook that drives a tab-capture video recording from the sidepanel UI.
 * Talks to the SW via VIDEO_REQUEST and listens for VIDEO_EVENT broadcasts
 * coming back from the offscreen recorder. Uploads the resulting blob to
 * cld_files and appends a row to the recordings store so the user sees the
 * recording in their list.
 *
 * Lifecycle states:
 *   - idle           — nothing active
 *   - permission     — checking / requesting tabCapture
 *   - starting       — VIDEO_REQUEST sent, waiting for `started`
 *   - recording      — `started` received, capturing
 *   - stopping       — user stopped or duration elapsed; awaiting `complete`
 *   - uploading      — bytes received, posting to cld_files
 *   - error          — terminal; the consumer can reset by calling reset()
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadFile } from '@/lib/api/routes/files';
import { log } from '@/lib/debug/log';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  hasOptionalPermissions,
  requestOptionalPermission,
} from '@/lib/permissions/optional';
import {
  useRecordingsStore,
  type RecordingEntry,
} from '@/lib/video/recordings-store';
import type { VideoEvent, VideoRequestPayload } from '@/lib/video/video-types';

export type RecorderStatus =
  | 'idle'
  | 'permission'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'uploading'
  | 'error';

/** Sub-state for the optional-permission dialog flow. */
export type TabCapturePermissionState =
  | 'unknown'
  | 'prompt'
  | 'denied'
  | 'granted';

export interface UseTabVideoRecorderResult {
  status: RecorderStatus;
  errorMessage: string | null;
  /** ms since `started`. Updates roughly every 200ms while recording. */
  elapsedMs: number;
  /** Wall-clock duration of the most recent finished recording. */
  lastDurationMs: number | null;
  /** Active session id; null when idle. */
  sessionId: string | null;
  /**
   * Whether the consumer should render the in-app permission dialog. The
   * `permissionMode` decides which dialog body to show.
   */
  permissionDialogOpen: boolean;
  permissionMode: 'prompt' | 'denied';
  /** Begin the recording flow. May open the permission dialog first. */
  start: (opts: { tabId: number; durationMs: number; audio: boolean }) => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
  /** Called when the user clicks the dialog's primary CTA. */
  confirmPermissionDialog: () => Promise<void>;
  /** Called when the user dismisses the dialog. */
  closePermissionDialog: () => void;
}

function newSessionId(): string {
  return `vid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function sanitizeFilename(input: string): string {
  return (
    input
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'recording'
  );
}

function extensionFor(mimeType: string): string {
  if (mimeType.startsWith('video/webm')) return 'webm';
  if (mimeType.startsWith('video/mp4')) return 'mp4';
  return 'webm';
}

export function useTabVideoRecorder(): UseTabVideoRecorderResult {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastDurationMs, setLastDurationMs] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [permissionMode, setPermissionMode] = useState<'prompt' | 'denied'>(
    'prompt',
  );

  const sessionIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tabSnapshotRef = useRef<{ title: string | null; url: string | null }>({
    title: null,
    url: null,
  });
  const audioRef = useRef<boolean>(false);
  const pendingStartRef = useRef<{
    tabId: number;
    durationMs: number;
    audio: boolean;
  } | null>(null);
  const addRecording = useRecordingsStore((s) => s.add);

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopTick();
    setStatus('idle');
    setErrorMessage(null);
    setElapsedMs(0);
    setSessionId(null);
    sessionIdRef.current = null;
  }, [stopTick]);

  const handleComplete = useCallback(
    async (data: ArrayBuffer, mimeType: string, durationMs: number, source: 'tab' | 'display') => {
      setStatus('uploading');
      setLastDurationMs(durationMs);
      const ext = extensionFor(mimeType);
      const titleBase = tabSnapshotRef.current.title
        ? sanitizeFilename(tabSnapshotRef.current.title)
        : 'tab';
      const filename = `${titleBase}-${Date.now()}.${ext}`;

      // Copy through a fresh ArrayBuffer to ensure Blob's TS BlobPart
      // contract is satisfied (no SharedArrayBuffer coercion).
      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(new Uint8Array(data));
      const blob = new Blob([buffer], { type: mimeType });

      try {
        const upload = await uploadFile(blob, filename, {
          path: `browser-agent/recordings/${filename}`,
          metadata: {
            source: source === 'tab' ? 'tab_capture' : 'display_capture',
            duration_ms: durationMs,
            audio: audioRef.current,
          },
        });
        const entry: RecordingEntry = {
          id: sessionIdRef.current ?? newSessionId(),
          capturedAt: new Date().toISOString(),
          tabTitle: tabSnapshotRef.current.title,
          tabUrl: tabSnapshotRef.current.url,
          fileId: upload.file_id,
          fileUrl: upload.url ?? upload.cdn_url ?? null,
          durationMs,
          sizeBytes: blob.size,
          mimeType,
          audio: audioRef.current,
          source,
        };
        await addRecording(entry);
        reset();
      } catch (err) {
        log.error('sys', 'recording upload failed', err);
        setStatus('error');
        setErrorMessage(`Upload failed: ${(err as Error).message}`);
      }
    },
    [addRecording, reset],
  );

  // Subscribe once to VIDEO_EVENT broadcasts. We filter by sessionIdRef so
  // recordings started in other surfaces don't trigger our state machine.
  useEffect(() => {
    const listener = (msg: unknown): boolean | undefined => {
      if (
        !msg ||
        typeof msg !== 'object' ||
        (msg as { __matrx?: unknown }).__matrx !== true ||
        (msg as { kind?: unknown }).kind !== CHANNELS.VIDEO_EVENT
      ) {
        return false;
      }
      const event = (msg as { payload?: VideoEvent }).payload;
      if (!event) return false;
      const expected = sessionIdRef.current;
      if (!expected || event.sessionId !== expected) return false;

      switch (event.type) {
        case 'started': {
          startTimeRef.current = Date.now();
          setElapsedMs(0);
          setStatus('recording');
          stopTick();
          tickRef.current = setInterval(() => {
            setElapsedMs(Date.now() - startTimeRef.current);
          }, 200);
          break;
        }
        case 'stopped': {
          setStatus('stopping');
          stopTick();
          break;
        }
        case 'complete': {
          stopTick();
          void handleComplete(event.data, event.mimeType, event.durationMs, event.source);
          break;
        }
        case 'error': {
          stopTick();
          setStatus('error');
          setErrorMessage(event.message);
          break;
        }
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      stopTick();
    };
  }, [handleComplete, stopTick]);

  const launchRecording = useCallback(
    async (opts: { tabId: number; durationMs: number; audio: boolean }) => {
      // Snapshot the tab so we can label the recording entry once it lands.
      try {
        const tab = await chrome.tabs.get(opts.tabId);
        tabSnapshotRef.current = {
          title: tab?.title ?? null,
          url: tab?.url ?? null,
        };
      } catch {
        tabSnapshotRef.current = { title: null, url: null };
      }

      audioRef.current = opts.audio;
      const id = newSessionId();
      sessionIdRef.current = id;
      setSessionId(id);
      setStatus('starting');
      setElapsedMs(0);
      setLastDurationMs(null);

      const payload: VideoRequestPayload = {
        sessionId: id,
        action: 'start',
        targetTabId: opts.tabId,
        audio: opts.audio,
        durationMs: opts.durationMs,
        source: 'tab',
      };
      try {
        const res = (await chrome.runtime.sendMessage({
          __matrx: true,
          kind: CHANNELS.VIDEO_REQUEST,
          payload,
        })) as { ok?: boolean; __error?: string } | undefined;
        if (res && '__error' in res && res.__error) {
          setStatus('error');
          setErrorMessage(res.__error);
        }
      } catch (err) {
        setStatus('error');
        setErrorMessage(`Failed to start recording: ${(err as Error).message}`);
      }
    },
    [],
  );

  const start = useCallback(
    async (opts: { tabId: number; durationMs: number; audio: boolean }) => {
      setErrorMessage(null);
      setStatus('permission');
      const granted = await hasOptionalPermissions(['tabCapture']);
      if (granted) {
        await launchRecording(opts);
        return;
      }
      // Defer the actual recording start until the user OKs the dialog.
      // Reset back to idle so the Start button isn't stuck mid-flight.
      pendingStartRef.current = opts;
      setPermissionMode('prompt');
      setPermissionDialogOpen(true);
      setStatus('idle');
    },
    [launchRecording],
  );

  const confirmPermissionDialog = useCallback(async () => {
    if (permissionMode === 'denied') {
      // Open the extension's own permission page in a new tab. We navigate
      // FOR the user — they don't get a "go to chrome://extensions" lecture.
      try {
        await chrome.tabs.create({
          url: `chrome://extensions/?id=${chrome.runtime.id}`,
        });
      } catch (err) {
        log.warn('sys', 'open extension permissions failed', err);
      }
      setPermissionDialogOpen(false);
      pendingStartRef.current = null;
      return;
    }

    // prompt mode — request the optional permission. If granted, run the
    // pending start; if denied, flip the dialog into denied mode.
    const ok = await requestOptionalPermission('tabCapture');
    if (!ok) {
      setPermissionMode('denied');
      return;
    }
    setPermissionDialogOpen(false);
    const pending = pendingStartRef.current;
    pendingStartRef.current = null;
    if (pending) {
      await launchRecording(pending);
    }
  }, [permissionMode, launchRecording]);

  const closePermissionDialog = useCallback(() => {
    setPermissionDialogOpen(false);
    pendingStartRef.current = null;
  }, []);

  const stop = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    setStatus('stopping');
    const payload: VideoRequestPayload = { sessionId: id, action: 'stop' };
    try {
      await chrome.runtime.sendMessage({
        __matrx: true,
        kind: CHANNELS.VIDEO_REQUEST,
        payload,
      });
    } catch (err) {
      log.warn('sys', 'video stop forward failed', err);
    }
  }, []);

  return {
    status,
    errorMessage,
    elapsedMs,
    lastDurationMs,
    sessionId,
    permissionDialogOpen,
    permissionMode,
    start,
    stop,
    reset,
    confirmPermissionDialog,
    closePermissionDialog,
  };
}
