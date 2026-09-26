import { useActiveTab } from '@/hooks/use-active-tab';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { onActiveOrganizationChange } from '@/lib/org/active-org';
import { lookupCapturedByUrl } from '@/lib/supabase/queries';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface RecognitionState {
  capturedAt: string | null;
  capturedId: string | null;
  loading: boolean;
  /**
   * True when the lookup FAILED — we do not know whether this page was saved.
   * Never shown as "not saved": the surface says it could not check.
   */
  checkFailed: boolean;
  /** The lookup could not run until this device has a selected workspace. */
  checkNeedsOrganization: boolean;
}

export function usePageRecognition(): RecognitionState {
  const tab = useActiveTab();
  const lookupSerial = useRef(0);
  const [organizationVersion, setOrganizationVersion] = useState(0);
  const [state, setState] = useState<RecognitionState>({
    capturedAt: null,
    capturedId: null,
    loading: false,
    checkFailed: false,
    checkNeedsOrganization: false,
  });

  const recheck = useCallback(() => {
    // Invalidate an outstanding lookup immediately, before React runs the
    // next effect. A late answer for the old workspace must not win.
    lookupSerial.current += 1;
    setState({
      capturedAt: null,
      capturedId: null,
      loading: true,
      checkFailed: false,
      checkNeedsOrganization: false,
    });
    setOrganizationVersion((version) => version + 1);
  }, []);

  useEffect(() => onActiveOrganizationChange(recheck), [recheck]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a workspace switch must rerun recognition even when the tab URL is unchanged.
  useEffect(() => {
    if (!tab.url) {
      setState({
        capturedAt: null,
        capturedId: null,
        loading: false,
        checkFailed: false,
        checkNeedsOrganization: false,
      });
      return;
    }
    let cancelled = false;
    const serial = ++lookupSerial.current;
    setState({
      capturedAt: null,
      capturedId: null,
      loading: true,
      checkFailed: false,
      checkNeedsOrganization: false,
    });
    void (async () => {
      const lookup = await lookupCapturedByUrl(tab.url as string);
      if (cancelled || serial !== lookupSerial.current) return;
      const captured = lookup.status === 'found' ? lookup.page : null;
      setState({
        capturedAt: captured?.captured_at ?? null,
        capturedId: captured?.id ?? null,
        loading: false,
        checkFailed: lookup.status === 'unknown',
        checkNeedsOrganization:
          lookup.status === 'unknown' && lookup.cause === 'organization_unselected',
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.url, organizationVersion]);

  useEffect(() => {
    return on<{ url: string; capturedAt: string; id: string }, { ack: true }>(
      CHANNELS.PAGE_ALREADY_CAPTURED,
      (payload) => {
        if (payload.url !== tab.url) return { ack: true };
        // The broadcast does not carry an organization. It may come from a
        // background lookup that began before a workspace switch, so only a
        // fresh scoped lookup can turn it into a Saved claim.
        recheck();
        return { ack: true };
      },
    );
  }, [tab.url, recheck]);

  return state;
}
