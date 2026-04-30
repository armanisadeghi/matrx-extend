import { useActiveTab } from '@/hooks/use-active-tab';
import { CHANNELS } from '@/lib/messaging/schemas';
import { lookupCapturedByUrl } from '@/lib/supabase/queries';
import { useEffect, useState } from 'react';
import { onMessage } from 'webext-bridge/window';

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
    onMessage(CHANNELS.PAGE_ALREADY_CAPTURED, ({ data }) => {
      const payload = data as { url: string; capturedAt: string; id: string };
      if (payload.url !== tab.url) return { ignored: true };
      setState({
        capturedAt: payload.capturedAt,
        capturedId: payload.id,
        loading: false,
      });
      return { ack: true };
    });
  }, [tab.url]);

  return state;
}
