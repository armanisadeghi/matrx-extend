/**
 * useRecordAndTranscribe
 *
 * Thin wrapper around useChunkedRecordAndTranscribe with a backward-compatible
 * API. Ported from matrx-frontend/features/audio/hooks/useRecordAndTranscribe.ts.
 *
 * - `streaming: true` (default): chunked recording, real-time transcript.
 * - `streaming: false`: single-shot transcription after recording stops.
 *
 * Both modes share the same IndexedDB safety net and error handling.
 */

import { AUDIO_LIMITS } from './constants';
import type { TranscriptionOptions, TranscriptionResult } from './types';
import {
  type UseChunkedRecordAndTranscribeProps,
  useChunkedRecordAndTranscribe,
} from './useChunkedRecordAndTranscribe';

export interface UseRecordAndTranscribeProps {
  onTranscriptionComplete?: (result: TranscriptionResult) => void;
  onChunkTranscribed?: (chunkText: string, accumulatedText: string) => void;
  onChunkError?: (chunkIndex: number, error: string) => void;
  onError?: (error: string, errorCode?: string) => void;
  autoTranscribe?: boolean;
  streaming?: boolean;
  transcriptionOptions?: TranscriptionOptions;
}

const SINGLE_SHOT_CHUNK_MS = 30 * 60 * 1000;

export function useRecordAndTranscribe({
  onTranscriptionComplete,
  onChunkTranscribed,
  onChunkError,
  onError,
  autoTranscribe = true,
  streaming = true,
  transcriptionOptions,
}: UseRecordAndTranscribeProps = {}) {
  const chunkDurationMs = streaming ? AUDIO_LIMITS.CHUNK_DURATION_MS : SINGLE_SHOT_CHUNK_MS;

  const chunkedProps: UseChunkedRecordAndTranscribeProps = {
    onTranscriptionComplete: autoTranscribe ? onTranscriptionComplete : undefined,
    onChunkTranscribed: streaming ? onChunkTranscribed : undefined,
    onChunkError,
    onError,
    chunkDurationMs,
    transcriptionOptions,
  };

  const {
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
  } = useChunkedRecordAndTranscribe(chunkedProps);

  return {
    isRecording,
    isPaused,
    duration,
    audioLevel,
    isTranscribing,
    liveTranscript,
    failedChunkCount,
    isProcessing: isRecording || isTranscribing,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    reset,
  };
}
