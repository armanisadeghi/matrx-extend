/**
 * useCartesiaSpeaker
 *
 * Lazy Cartesia TTS engine. Does nothing until speak() is called.
 * Manages: token fetch → websocket → send → WebPlayer playback lifecycle.
 *
 * Ported from matrx-frontend/features/tts/hooks/useCartesiaSpeaker.ts.
 *
 * Differences from the source:
 *   - Token endpoint is the absolute matrx-frontend URL with a Bearer header.
 *   - Voice prefs come from `useVoicePrefsStore` (zustand) instead of Redux.
 *   - Errors flow through an optional `onError` callback rather than `sonner`
 *     toasts (no toast wrapper in the extension yet).
 */

import { CartesiaClient, WebPlayer } from '@cartesia/cartesia-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AUDIO_API_ROUTES } from '@/lib/audio/constants';
import { getAccessToken } from '@/lib/auth/flow';
import { useVoicePrefsStore } from '@/state/voice-prefs';
import { parseMarkdownToText } from './parse-markdown-for-speech';

export type SpeakerPhase =
  | 'idle'
  | 'fetching-token'
  | 'connecting'
  | 'sending'
  | 'playing'
  | 'paused'
  | 'error';

export interface UseCartesiaSpeakerOptions {
  processMarkdown?: boolean;
  /** Override stored language preference for this hook instance. */
  language?: string;
  /** Receives a user-friendly message on any failure. */
  onError?: (message: string) => void;
}

export function useCartesiaSpeaker({
  processMarkdown = true,
  language: languageOverride,
  onError,
}: UseCartesiaSpeakerOptions = {}) {
  const [phase, setPhase] = useState<SpeakerPhase>('idle');

  const websocketRef = useRef<ReturnType<CartesiaClient['tts']['websocket']> | null>(null);
  const playerRef = useRef<WebPlayer | null>(null);
  const hasPlayedRef = useRef(false);
  const mountedRef = useRef(true);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const voiceId = useVoicePrefsStore((s) => s.voice);
  const storedLanguage = useVoicePrefsStore((s) => s.language);
  const speed = useVoicePrefsStore((s) => s.speed);
  const language = languageOverride ?? storedLanguage;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (websocketRef.current) {
        websocketRef.current.disconnect();
        websocketRef.current = null;
      }
      if (playerRef.current && hasPlayedRef.current) {
        playerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const ensureConnection = useCallback(async () => {
    if (websocketRef.current) return;

    if (mountedRef.current) setPhase('fetching-token');

    let data: { token: string };
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not signed in. Please sign in to use TTS.');

      const res = await fetch(AUDIO_API_ROUTES.CARTESIA_TOKEN, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Token fetch failed: ${res.status}`);
      }
      data = await res.json();
    } catch (err) {
      if (mountedRef.current) setPhase('error');
      throw err;
    }

    if (mountedRef.current) setPhase('connecting');

    try {
      const client = new CartesiaClient();
      const ws = client.tts.websocket({
        container: 'raw',
        encoding: 'pcm_f32le',
        sampleRate: 44100,
      });

      const ctx = await ws.connect({ accessToken: data.token });
      ctx.on('close', () => {
        websocketRef.current = null;
        if (mountedRef.current) setPhase('idle');
      });

      websocketRef.current = ws;
    } catch (err) {
      if (mountedRef.current) setPhase('error');
      throw err;
    }
  }, []);

  const speak = useCallback(
    async (inputText: string) => {
      const processed = processMarkdown ? parseMarkdownToText(inputText) : inputText;
      if (!processed.trim()) {
        onErrorRef.current?.('Nothing to speak');
        return;
      }

      try {
        await ensureConnection();

        if (mountedRef.current) setPhase('sending');

        const resp = await websocketRef.current!.send({
          modelId: 'sonic-3',
          voice: {
            mode: 'id' as const,
            id: voiceId,
            experimentalControls: { speed, emotion: [] },
          },
          language,
          transcript: processed,
        });

        if (!playerRef.current) {
          playerRef.current = new WebPlayer({ bufferDuration: 0.25 });
        }

        if (mountedRef.current) setPhase('playing');

        hasPlayedRef.current = true;
        await playerRef.current.play(resp.source);

        if (mountedRef.current) setPhase('idle');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Speech failed';
        console.error('[useCartesiaSpeaker]', msg);
        onErrorRef.current?.(msg);
        if (mountedRef.current) setPhase('error');
      }
    },
    [voiceId, language, speed, processMarkdown, ensureConnection],
  );

  const pause = useCallback(async () => {
    if (playerRef.current && phase === 'playing') {
      try {
        await playerRef.current.pause();
        if (mountedRef.current) setPhase('paused');
      } catch (err) {
        console.error('[useCartesiaSpeaker] pause failed:', err);
        if (mountedRef.current) setPhase('idle');
      }
    }
  }, [phase]);

  const resume = useCallback(async () => {
    if (playerRef.current && phase === 'paused') {
      try {
        await playerRef.current.resume();
        if (mountedRef.current) setPhase('playing');
      } catch (err) {
        console.error('[useCartesiaSpeaker] resume failed:', err);
        if (mountedRef.current) setPhase('idle');
      }
    }
  }, [phase]);

  const stop = useCallback(async () => {
    if (playerRef.current && hasPlayedRef.current) {
      try {
        await playerRef.current.stop();
      } catch (err) {
        console.error('[useCartesiaSpeaker] stop failed:', err);
      }
    }
    if (mountedRef.current) setPhase('idle');
  }, []);

  const isLoading = phase === 'fetching-token' || phase === 'connecting' || phase === 'sending';
  const isPlaying = phase === 'playing';
  const isPaused = phase === 'paused';

  return {
    phase,
    isLoading,
    isPlaying,
    isPaused,
    speak,
    pause,
    resume,
    stop,
  };
}
