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
  draft: UserFormProfile;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  setField: <K extends keyof UserFormProfile>(key: K, value: UserFormProfile[K]) => void;
  resetDraft: () => void;
  save: () => Promise<{ ok: boolean }>;
  refresh: () => Promise<void>;
}

export function useUserProfile(): UseUserProfileResult {
  const { user } = useAuth();
  const [savedProfile, setSavedProfile] = useState<UserFormProfile | null>(null);
  const [draft, setDraft] = useState<UserFormProfile>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastUserIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) {
      setSavedProfile(null);
      setDraft(emptyProfile());
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await fetchUserFormProfile(user.id);
    if (!res.ok) {
      // Surface load failures — the existing error banner renders this.
      setError(`Could not load your profile: ${res.error}`);
      setLoading(false);
      return;
    }
    setError(null);
    setSavedProfile(res.profile);
    setDraft(res.profile ?? emptyProfile());
    setLoading(false);
  }, [user?.id]);

  // Reload when the signed-in user changes; the boot guard in useAuth keeps
  // this from thrashing on every mount.
  useEffect(() => {
    if (lastUserIdRef.current === (user?.id ?? null)) return;
    lastUserIdRef.current = user?.id ?? null;
    void load();
  }, [user?.id, load]);

  const setField = useCallback(
    <K extends keyof UserFormProfile>(key: K, value: UserFormProfile[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const resetDraft = useCallback(() => {
    setDraft(savedProfile ?? emptyProfile());
  }, [savedProfile]);

  const dirty = useMemo(() => {
    const baseline = savedProfile ?? emptyProfile();
    return JSON.stringify(baseline) !== JSON.stringify(draft);
  }, [savedProfile, draft]);

  const save = useCallback(async () => {
    if (!user?.id) return { ok: false };
    setSaving(true);
    setError(null);
    const patch: UserFormProfilePatch = computePatch(savedProfile, draft);
    const result = await upsertUserFormProfile(user.id, patch);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return { ok: false };
    }
    await load();
    return { ok: true };
  }, [user?.id, savedProfile, draft, load]);

  return {
    loading,
    draft,
    dirty,
    saving,
    error,
    setField,
    resetDraft,
    save,
    refresh: load,
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
