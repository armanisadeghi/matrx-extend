/**
 * useUserProfile — loads + mutates user_form_profile + user_sensitive_items.
 *
 * One round-trip on mount via get_user_form_context RPC. Local edits are
 * staged in `draft`; calling save() upserts only the dirty subset and
 * refetches. Sensitive items go through their own RPCs (set/delete) and
 * locally refresh the listing on success.
 */

import { useAuth } from '@/hooks/use-auth';
import {
  type UserFormContext,
  type UserFormProfile,
  type UserFormProfilePatch,
  type SetSensitiveItemArgs,
  deleteSensitiveItem,
  emptyProfile,
  fetchUserFormContext,
  setSensitiveItem,
  upsertUserFormProfile,
} from '@/lib/supabase/user-profile';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface UseUserProfileResult {
  loading: boolean;
  context: UserFormContext | null;
  draft: UserFormProfile;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  setField: <K extends keyof UserFormProfile>(key: K, value: UserFormProfile[K]) => void;
  resetDraft: () => void;
  save: () => Promise<{ ok: boolean }>;
  refresh: () => Promise<void>;
  saveSensitive: (args: SetSensitiveItemArgs) => Promise<{ ok: boolean; error?: string }>;
  removeSensitive: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

export function useUserProfile(): UseUserProfileResult {
  const { user } = useAuth();
  const [context, setContext] = useState<UserFormContext | null>(null);
  const [draft, setDraft] = useState<UserFormProfile>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastUserIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) {
      setContext(null);
      setDraft(emptyProfile());
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctx = await fetchUserFormContext(user.id);
    setContext(ctx);
    setDraft(ctx?.profile ?? emptyProfile());
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
    setDraft(context?.profile ?? emptyProfile());
  }, [context]);

  const dirty = useMemo(() => {
    const baseline = context?.profile ?? emptyProfile();
    return JSON.stringify(baseline) !== JSON.stringify(draft);
  }, [context, draft]);

  const save = useCallback(async () => {
    if (!user?.id) return { ok: false };
    setSaving(true);
    setError(null);
    const patch: UserFormProfilePatch = computePatch(context?.profile ?? null, draft);
    const result = await upsertUserFormProfile(user.id, patch);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return { ok: false };
    }
    await load();
    return { ok: true };
  }, [user?.id, context, draft, load]);

  const saveSensitive = useCallback(
    async (args: SetSensitiveItemArgs) => {
      const result = await setSensitiveItem(args);
      if (!result.ok) return { ok: false, error: result.error };
      await load();
      return { ok: true };
    },
    [load],
  );

  const removeSensitive = useCallback(
    async (id: string) => {
      const result = await deleteSensitiveItem(id);
      if (!result.ok) return { ok: false, error: result.error };
      await load();
      return { ok: true };
    },
    [load],
  );

  return {
    loading,
    context,
    draft,
    dirty,
    saving,
    error,
    setField,
    resetDraft,
    save,
    refresh: load,
    saveSensitive,
    removeSensitive,
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
