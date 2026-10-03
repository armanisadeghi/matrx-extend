/**
 * useUserProfile — loads + mutates user_form_profile.
 *
 * One owner-scoped row read on mount. Local edits are
 * staged in `draft`; calling save() upserts only the dirty subset and
 * refetches.
 */

import { useAuth } from '@/hooks/use-auth';
import {
  type UserFormProfile,
  type UserFormProfilePatch,
  emptyProfile,
  fetchUserFormProfile,
  upsertUserFormProfile,
} from '@/lib/supabase/user-profile';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface UseUserProfileResult {
  loading: boolean;
  loadError: string | null;
  draft: UserFormProfile;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  setField: <K extends keyof UserFormProfile>(key: K, value: UserFormProfile[K]) => void;
  resetDraft: () => void;
  save: () => Promise<{ ok: boolean }>;
  refresh: () => Promise<void>;
}

interface ProfileOwner {
  id: string | undefined;
  read: number;
  writing: boolean;
  mounted: boolean;
}

interface ProfileState {
  owner: ProfileOwner;
  read: number;
  saved: UserFormProfile | null;
  draft: UserFormProfile;
  ready: boolean;
  loading: boolean;
  saving: boolean;
  loadError: string | null;
  error: string | null;
}

function initialState(owner: ProfileOwner): ProfileState {
  return {
    owner,
    read: owner.read,
    saved: null,
    draft: emptyProfile(),
    ready: false,
    loading: Boolean(owner.id),
    saving: false,
    loadError: null,
    error: null,
  };
}

export function useUserProfile(): UseUserProfileResult {
  const { user } = useAuth();
  // Each identity transition gets a distinct lifetime, including A → B → A.
  const owner = useMemo<ProfileOwner>(
    () => ({ id: user?.id, read: 0, writing: false, mounted: true }),
    [user?.id],
  );
  const activeOwner = useRef(owner);
  activeOwner.current = owner;
  const [stored, setStored] = useState(() => initialState(owner));
  // Mask synchronously: a passive effect is too late to hide another owner's data.
  const state = stored.owner === owner ? stored : initialState(owner);
  const currentState = useRef(state);
  currentState.current = state;

  const isCurrent = useCallback(() => activeOwner.current === owner && owner.mounted, [owner]);
  const load = useCallback(async (): Promise<boolean> => {
    if (!owner.id || !isCurrent()) return false;
    const read = ++owner.read;
    setStored((previous) => ({
      ...(previous.owner === owner ? previous : initialState(owner)),
      loading: true,
      ready: false,
      loadError: null,
    }));
    try {
      const result = await fetchUserFormProfile(owner.id);
      if (!isCurrent() || read !== owner.read) return false;
      if (!result.ok) {
        setStored((previous) => ({
          ...previous,
          loading: false,
          ready: false,
          loadError: `Could not load your profile: ${result.error}`,
        }));
        return false;
      }
      setStored((previous) => ({
        ...previous,
        owner,
        read,
        saved: result.profile,
        draft: result.profile ?? emptyProfile(),
        loading: false,
        ready: true,
        loadError: null,
        error: null,
      }));
      return true;
    } catch (error) {
      if (!isCurrent() || read !== owner.read) return false;
      setStored((previous) => ({
        ...previous,
        loading: false,
        ready: false,
        loadError: `Could not load your profile: ${error instanceof Error ? error.message : String(error)}`,
      }));
      return false;
    }
  }, [owner, isCurrent]);

  useEffect(() => {
    owner.mounted = true;
    void load();
    return () => {
      owner.mounted = false;
      owner.read += 1;
    };
  }, [owner, load]);

  const setField = useCallback(
    <K extends keyof UserFormProfile>(key: K, value: UserFormProfile[K]) => {
      if (!isCurrent()) return;
      setStored((previous) =>
        previous.owner === owner && previous.ready && !owner.writing
          ? { ...previous, draft: { ...previous.draft, [key]: value } }
          : previous,
      );
    },
    [owner, isCurrent],
  );
  const resetDraft = useCallback(() => {
    if (!isCurrent()) return;
    setStored((previous) =>
      previous.owner === owner && previous.ready && !owner.writing
        ? { ...previous, draft: previous.saved ?? emptyProfile() }
        : previous,
    );
  }, [owner, isCurrent]);

  const save = useCallback(async () => {
    const snapshot = currentState.current;
    if (
      !owner.id ||
      !isCurrent() ||
      snapshot.owner !== owner ||
      !snapshot.ready ||
      snapshot.read !== owner.read ||
      owner.writing
    ) {
      return { ok: false };
    }
    owner.writing = true;
    const read = owner.read;
    setStored((previous) => ({ ...previous, saving: true, error: null }));
    try {
      const result = await upsertUserFormProfile(
        owner.id,
        computePatch(snapshot.saved, snapshot.draft),
      );
      if (!isCurrent()) return { ok: false };
      // A newer explicit refresh owns its result; an old save cannot supersede it.
      if (read !== owner.read) return { ok: false };
      if (!result.ok) {
        setStored((previous) => ({ ...previous, error: result.error }));
        return { ok: false };
      }
      return { ok: await load() };
    } catch (error) {
      if (isCurrent() && read === owner.read) {
        setStored((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      return { ok: false };
    } finally {
      owner.writing = false;
      if (isCurrent()) setStored((previous) => ({ ...previous, saving: false }));
    }
  }, [owner, isCurrent, load]);

  return {
    loading: state.loading,
    loadError: state.loadError,
    draft: state.draft,
    dirty:
      state.ready && JSON.stringify(state.saved ?? emptyProfile()) !== JSON.stringify(state.draft),
    saving: state.saving,
    error: state.error,
    setField,
    resetDraft,
    save,
    refresh: async () => {
      await load();
    },
  };
}

// Send only the fields the user changed. Empty diff still hits the row
// (upsert will create it on first save), but at least we don't overwrite
// columns we didn't touch.
function computePatch(
  baseline: UserFormProfile | null,
  draft: UserFormProfile,
): UserFormProfilePatch {
  const base = baseline ?? emptyProfile();
  const patch: UserFormProfilePatch = {};
  (Object.keys(draft) as (keyof UserFormProfile)[]).forEach((key) => {
    if (JSON.stringify(base[key]) !== JSON.stringify(draft[key])) {
      // biome-ignore lint/suspicious/noExplicitAny: index assignment across union types
      (patch as any)[key] = draft[key];
    }
  });
  return patch;
}
