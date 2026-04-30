import { useActiveTab } from '@/hooks/use-active-tab';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { lookupCapturedByUrl } from '@/lib/supabase/queries';
import { useEffect, useState } from 'react';

export interface RecognitionState {
  capturedAt: string | null;
  capturedId: string | null;
  loading: boolean;
}

export function usePageRecognition(): RecognitionState {
  const tab = useActiveTab();
  const [state, setState] = useState<RecognitionState>({
    capturedAt: null,
    capturedId: null,
    loading: false,
  });

  useEffect(() => {
    if (!tab.url) {
      setState({ capturedAt: null, capturedId: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    void (async () => {
      const captured = await lookupCapturedByUrl(tab.url as string);
      if (cancelled) return;
      setState({
        capturedAt: captured?.captured_at ?? null,
        capturedId: captured?.id ?? null,
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.url]);

  useEffect(() => {
    return on<{ url: string; capturedAt: string; id: string }, { ack: true }>(
      CHANNELS.PAGE_ALREADY_CAPTURED,
      (payload) => {
        if (payload.url !== tab.url) return { ack: true };
        setState({
          capturedAt: payload.capturedAt,
          capturedId: payload.id,
          loading: false,
        });
        return { ack: true };
      },
    );
  }, [tab.url]);

  return state;
}
