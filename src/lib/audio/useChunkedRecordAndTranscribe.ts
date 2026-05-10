/**
 * useChunkedRecordAndTranscribe
 *
 * Streaming mic-to-transcript hook. The MediaRecorder + getUserMedia live
 * in the offscreen document (Chrome MV3 side-panel mic permission is
 * unreliable; offscreen with `USER_MEDIA` reason works robustly). This hook
 * is a thin client:
 *
 *   - sends MIC_REQUEST {action:'start'} to the SW (which ensures offscreen
 *     and forwards as MIC_RUN to the offscreen recorder)
 *   - subscribes to MIC_EVENT broadcasts for chunks, audio levels, lifecycle,
 *     and errors
 *   - transcribes each chunk via the matrx-frontend route
 *     (`https://aimatrx.com/api/audio/transcribe`) with a Bearer token
 *   - persists chunks + accumulated text to IndexedDB so a crash doesn't
 *     lose audio
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAccessToken } from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';
import { base64ToBlob } from '@/lib/messaging/binary-transport';
import { CHANNELS } from '@/lib/messaging/schemas';
import { audioSafetyStore } from './audioSafetyStore';
import { AUDIO_API_ROUTES, AUDIO_LIMITS } from './constants';
import type { MicEvent, MicRequestPayload } from './mic-types';
import type { TranscriptionOptions, TranscriptionResult } from './types';

export interface ChunkCompleteInfo {
  chunkIndex: number;
  tStart: number;
  tEnd: number;
  text: string;
  accumulatedText: string;
}

export interface UseChunkedRecordAndTranscribeProps {
  onTranscriptionComplete?: (result: TranscriptionResult) => void;
  onChunkTranscribed?: (chunkText: string, accumulatedText: string) => void;
  onChunkComplete?: (info: ChunkCompleteInfo) => void;
  onChunkError?: (chunkIndex: number, error: string) => void;
  onError?: (error: string, errorCode?: string) => void;
  chunkDurationMs?: number;
  transcriptionOptions?: TranscriptionOptions;
}

async function sendMicRequest(payload: MicRequestPayload): Promise<void> {
  const env = { __matrx: true, kind: CHANNELS.MIC_REQUEST, payload };
  log.info('audio', 'hook: MIC_REQUEST → start sent', { action: payload.action, payload });
  const res = (await chrome.runtime.sendMessage(env)) as { __error?: string } | { ok: true } | undefined;
  log.info('audio', 'hook: MIC_REQUEST result', { res });
  if (res && typeof res === 'object' && '__error' in res) {
    throw new Error((res as { __error: string }).__error);
  }
}

async function logClientError(entry: {
  errorCode: string;
  errorMessage: string;
  fileSizeBytes?: number;
  chunkIndex?: number;
  apiRoute?: string;
}): Promise<void> {
  try {
    const token = await getAccessToken();
    if (!token) return;
    await fetch(AUDIO_API_ROUTES.LOG_ERROR, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(entry),
    });
  } catch {
    /* non-critical */
  }
}

export function useChunkedRecordAndTranscribe({
  onTranscriptionComplete,
  onChunkTranscribed,
  onChunkComplete,
  onChunkError,
  onError,
  chunkDurationMs = AUDIO_LIMITS.CHUNK_DURATION_MS,
  transcriptionOptions,
}: UseChunkedRecordAndTranscribeProps = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [failedChunkCount, setFailedChunkCount] = useState(0);

  const accumulatedRef = useRef('');
  const pendingRef = useRef(0);
  const isStoppingRef = useRef(false);
  const safetyIdRef = useRef<string>('');
  const failedIndicesRef = useRef<number[]>([]);
  const transcriptsMapRef = useRef<Map<number, string>>(new Map());
  const allChunkBlobsRef = useRef<Blob[]>([]);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const onTranscriptionCompleteRef = useRef(onTranscriptionComplete);
  const onChunkTranscribedRef = useRef(onChunkTranscribed);
  const onChunkCompleteRef = useRef(onChunkComplete);
  const onChunkErrorRef = useRef(onChunkError);
  const onErrorRef = useRef(onError);
  const transcriptionOptionsRef = useRef(transcriptionOptions);
  useEffect(() => {
    onTranscriptionCompleteRef.current = onTranscriptionComplete;
  }, [onTranscriptionComplete]);
  useEffect(() => {
    onChunkTranscribedRef.current = onChunkTranscribed;
  }, [onChunkTranscribed]);
  useEffect(() => {
    onChunkCompleteRef.current = onChunkComplete;
  }, [onChunkComplete]);
  useEffect(() => {
    onChunkErrorRef.current = onChunkError;
  }, [onChunkError]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    transcriptionOptionsRef.current = transcriptionOptions;
  }, [transcriptionOptions]);

  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  const startDurationTimer = useCallback(() => {
    stopDurationTimer();
    durationTimerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 250);
  }, [stopDurationTimer]);

  const persistText = useCallback(async (text: string) => {
    if (safetyIdRef.current) {
      try {
        await audioSafetyStore.saveText(safetyIdRef.current, text);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const maybeFireFinal = useCallback(async () => {
    if (!isStoppingRef.current || pendingRef.current > 0) return;
    const finalText = accumulatedRef.current.trim();
    setIsTranscribing(false);
    if (safetyIdRef.current) {
      try {
        await audioSafetyStore.markComplete(safetyIdRef.current);
      } catch {
        /* ignore */
      }
    }
    onTranscriptionCompleteRef.current?.({ success: true, text: finalText });
  }, []);

  const transcribeBlob = useCallback(
    async (blob: Blob, idx: number, tStart: number, tEnd: number) => {
      if (blob.size < AUDIO_LIMITS.MIN_CHUNK_BYTES) {
        maybeFireFinal();
        return;
      }

      allChunkBlobsRef.current.push(blob);
      if (safetyIdRef.current) {
        try {
          await audioSafetyStore.saveChunk(safetyIdRef.current, blob);
        } catch {
          /* ignore */
        }
      }

      let blobToSend = blob;
      let isCombo = false;
      if (idx === 2) {
        blobToSend = new Blob(allChunkBlobsRef.current.slice(0, 3), { type: blob.type });
        isCombo = true;
      }

      pendingRef.current += 1;
      setIsTranscribing(true);

      try {
        const opts = transcriptionOptionsRef.current;
        const ext = blobToSend.type.includes('webm') ? 'webm' : 'wav';
        const form = new FormData();
        form.append('file', new File([blobToSend], `chunk.${ext}`, { type: blobToSend.type }));
        if (opts?.language) form.append('language', opts.language);
        if (opts?.prompt) form.append('prompt', opts.prompt);

        const token = await getAccessToken();
        if (!token) throw new Error('Not signed in. Please sign in to use voice input.');

        log.info('audio', 'hook: transcribe POST start', {
          chunkIndex: idx,
          bytes: blobToSend.size,
          isCombo,
          url: AUDIO_API_ROUTES.TRANSCRIBE,
        });
        const res = await fetch(AUDIO_API_ROUTES.TRANSCRIBE, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        const data = await res.json();
        const textLen = typeof data?.text === 'string' ? data.text.length : 0;
        if (res.ok) {
          log.success('audio', 'hook: transcribe POST done', {
            chunkIndex: idx,
            status: res.status,
            textLen,
          });
        } else {
          log.error('audio', 'hook: transcribe POST failed', {
            chunkIndex: idx,
            status: res.status,
            body: data,
          });
        }
        if (!res.ok) throw new Error(data.error || data.details || `HTTP ${res.status}`);

        if (data.success && data.text?.trim()) {
          const snippet = (data.text as string).trim();

          if (isCombo) {
            transcriptsMapRef.current.set(0, '');
            transcriptsMapRef.current.set(1, '');
            transcriptsMapRef.current.set(2, snippet);
          } else if ((idx === 0 || idx === 1) && transcriptsMapRef.current.has(2)) {
            // late response eclipsed by the combo chunk; ignore
          } else {
            transcriptsMapRef.current.set(idx, snippet);
          }

          const full = Array.from(transcriptsMapRef.current.entries())
            .sort((a, b) => a[0] - b[0])
            .map((e) => e[1])
            .filter(Boolean)
            .join(' ');

          accumulatedRef.current = full;
          setLiveTranscript(full);
          await persistText(full);
          onChunkTranscribedRef.current?.(snippet, full);
          onChunkCompleteRef.current?.({
            chunkIndex: idx,
            tStart,
            tEnd,
            text: snippet,
            accumulatedText: full,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Chunk transcription failed';
        log.error('audio', 'hook: chunk transcription failed', {
          chunkIndex: idx,
          message: msg,
          apiRoute: AUDIO_API_ROUTES.TRANSCRIBE,
        });
        failedIndicesRef.current.push(idx);
        setFailedChunkCount(failedIndicesRef.current.length);
        if (safetyIdRef.current) {
          try {
            await audioSafetyStore.addFailedChunk(safetyIdRef.current, idx);
          } catch {
            /* ignore */
          }
        }
        await logClientError({
          errorCode: 'CHUNK_FAILED',
          errorMessage: msg,
          fileSizeBytes: blobToSend.size,
          chunkIndex: idx,
          apiRoute: AUDIO_API_ROUTES.TRANSCRIBE,
        });
        onChunkErrorRef.current?.(idx, msg);
      } finally {
        pendingRef.current -= 1;
        maybeFireFinal();
      }
    },
    [maybeFireFinal, persistText],
  );

  // Subscribe to MIC_EVENT broadcasts from offscreen.
  useEffect(() => {
    const listener = (msg: unknown): boolean | undefined => {
      if (
        typeof msg !== 'object' ||
        msg === null ||
        (msg as Record<string, unknown>).__matrx !== true ||
        (msg as Record<string, unknown>).kind !== CHANNELS.MIC_EVENT
      ) {
        return false;
      }
      const event = (msg as { payload: MicEvent }).payload;
      // Skip the noisy level events from the trace log.
      if (event.type !== 'level') {
        log.info('audio', 'hook: MIC_EVENT received', { type: event.type, event });
      }
      if (event.type === 'level') {
        setAudioLevel(event.level);
      } else if (event.type === 'started') {
        setIsRecording(true);
        setIsPaused(false);
        setIsTranscribing(false);
        accumulatedRef.current = '';
        setLiveTranscript('');
        failedIndicesRef.current = [];
        setFailedChunkCount(0);
        transcriptsMapRef.current.clear();
        allChunkBlobsRef.current = [];
        startTimeRef.current = Date.now();
        startDurationTimer();
      } else if (event.type === 'paused') {
        setIsPaused(true);
        stopDurationTimer();
      } else if (event.type === 'resumed') {
        setIsPaused(false);
        startDurationTimer();
      } else if (event.type === 'stopped') {
        setIsRecording(false);
        setIsPaused(false);
        setAudioLevel(0);
        stopDurationTimer();
        if (pendingRef.current === 0) maybeFireFinal();
      } else if (event.type === 'error') {
        setIsRecording(false);
        setIsPaused(false);
        setAudioLevel(0);
        stopDurationTimer();
        onErrorRef.current?.(event.message, event.code);
      } else if (event.type === 'chunk') {
        // event.data MUST be a base64 string after 50b09f9. If it isn't,
        // an old offscreen build is broadcasting raw ArrayBuffer (which
        // `chrome.runtime.sendMessage`'s JSON serializer collapses to `{}`).
        // Bail loudly with an actionable hint instead of letting `atob`
        // throw a confusing native InvalidCharacterError mid-pipeline.
        if (typeof event.data !== 'string') {
          const dataKind = event.data === null ? 'null' : typeof event.data;
          log.error(
            'audio',
            'hook: chunk has non-string data — stale offscreen, reload the extension',
            {
              chunkIndex: event.chunkIndex,
              dataKind,
              mimeType: event.mimeType,
            },
          );
          onErrorRef.current?.(
            'Audio pipeline mismatch: the offscreen document is running stale code. ' +
              'Reload the extension from chrome://extensions and try again.',
            'STALE_OFFSCREEN',
          );
          return false;
        }
        // event.data is a base64 string (chrome.runtime.sendMessage uses
        // JSON, not structured clone). Decode back to a Blob before
        // sending to Whisper. See @/lib/messaging/binary-transport.
        const blob = base64ToBlob(event.data, event.mimeType);
        log.info('audio', 'hook: chunk received', {
          chunkIndex: event.chunkIndex,
          base64Length: event.data.length,
          decodedBytes: blob.size,
          mimeType: event.mimeType,
          tStart: event.tStart,
          tEnd: event.tEnd,
        });
        void transcribeBlob(blob, event.chunkIndex, event.tStart, event.tEnd);
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [maybeFireFinal, startDurationTimer, stopDurationTimer, transcribeBlob]);

  const startRecording = useCallback(async () => {
    isStoppingRef.current = false;
    pendingRef.current = 0;

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const safetyId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    safetyIdRef.current = safetyId;
    try {
      await audioSafetyStore.createEntry(safetyId, sessionId, 'audio/webm');
    } catch (err) {
      log.warn('audio', 'IndexedDB init failed, continuing without crash-safety persistence', err);
      safetyIdRef.current = '';
    }

    try {
      await sendMicRequest({ action: 'start', chunkDurationMs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start recording';
      log.error('audio', 'startRecording — MIC_REQUEST forward failed', err);
      // Surface to UI. Code is undefined here — the SW-side forwarding
      // failure is distinct from the offscreen MicErrorEvent codes.
      onErrorRef.current?.(msg);
    }
  }, [chunkDurationMs]);

  const stopRecording = useCallback(async () => {
    isStoppingRef.current = true;
    if (safetyIdRef.current) {
      audioSafetyStore.setStatus(safetyIdRef.current, 'transcribing').catch(() => {});
    }
    try {
      await sendMicRequest({ action: 'stop' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to stop recording';
      log.error('audio', 'stopRecording forward failed', err);
      onErrorRef.current?.(msg);
    }
  }, []);

  const pauseRecording = useCallback(async () => {
    try {
      await sendMicRequest({ action: 'pause' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to pause recording';
      log.error('audio', 'pauseRecording forward failed', err);
      onErrorRef.current?.(msg);
    }
  }, []);

  const resumeRecording = useCallback(async () => {
    try {
      await sendMicRequest({ action: 'resume' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resume recording';
      log.error('audio', 'resumeRecording forward failed', err);
      onErrorRef.current?.(msg);
    }
  }, []);

  const reset = useCallback(() => {
    setIsRecording(false);
    setIsTranscribing(false);
    setIsPaused(false);
    setDuration(0);
    setAudioLevel(0);
    setLiveTranscript('');
    setFailedChunkCount(0);
    accumulatedRef.current = '';
    pendingRef.current = 0;
    failedIndicesRef.current = [];
    transcriptsMapRef.current.clear();
    allChunkBlobsRef.current = [];
    isStoppingRef.current = false;
    stopDurationTimer();
  }, [stopDurationTimer]);

  // Cleanup the duration timer if the consumer unmounts mid-recording.
  // Don't auto-stop the offscreen recorder — the consumer might remount and
  // want to keep listening. The user must explicitly call stopRecording().
  useEffect(() => () => stopDurationTimer(), [stopDurationTimer]);

  return {
    isRecording,
    isTranscribing,
    isPaused,
    duration,
    audioLevel,
    liveTranscript,
    failedChunkCount,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    reset,
  };
}
