/**
 * user_form_profile — typed CRUD for the profile UI.
 *
 * Reads:
 *   - owner-scoped users.user_form_profile row through RLS
 *
 * Writes:
 *   - direct upsert on users.user_form_profile (RLS owner-only)
 */

import {
  isOrganizationNoMembershipsError,
  isOrganizationNotSelectedError,
  requireActiveOrganizationId,
} from '@/lib/org/active-org';
import { usersDb } from '@/lib/supabase/schemas';
import { z } from 'zod';

// ─── Multi-value sub-schemas ────────────────────────────────────────────────
export const PhoneSchema = z.object({
  label: z.string().nullable().optional(),
  value: z.string(),
  country_code: z.string().nullable().optional(),
  is_primary: z.boolean().optional(),
  sms_capable: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});
export type Phone = z.infer<typeof PhoneSchema>;

export const EmailEntrySchema = z.object({
  label: z.string().nullable().optional(),
  value: z.string(),
  is_primary: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});
export type EmailEntry = z.infer<typeof EmailEntrySchema>;

export const SocialHandleSchema = z.object({
  platform: z.string(),
  handle: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  is_public: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});
export type SocialHandle = z.infer<typeof SocialHandleSchema>;

export const EmergencyContactSchema = z.object({
  name: z.string(),
  relationship: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type EmergencyContact = z.infer<typeof EmergencyContactSchema>;

// ─── Profile ────────────────────────────────────────────────────────────────
export const UserFormProfileSchema = z.object({
  legal_first_name: z.string().nullable().optional(),
  legal_middle_name: z.string().nullable().optional(),
  legal_last_name: z.string().nullable().optional(),
  preferred_name: z.string().nullable().optional(),
  name_suffix: z.string().nullable().optional(),
  pronouns: z.string().nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  phones: z.array(PhoneSchema).default([]),
  emails: z.array(EmailEntrySchema).default([]),
  social_handles: z.array(SocialHandleSchema).default([]),
  website_url: z.string().nullable().optional(),
  shipping_line1: z.string().nullable().optional(),
  shipping_line2: z.string().nullable().optional(),
  shipping_city: z.string().nullable().optional(),
  shipping_region: z.string().nullable().optional(),
  shipping_postal_code: z.string().nullable().optional(),
  shipping_country: z.string().nullable().optional(),
  billing_same_as_shipping: z.boolean().default(true),
  billing_line1: z.string().nullable().optional(),
  billing_line2: z.string().nullable().optional(),
  billing_city: z.string().nullable().optional(),
  billing_region: z.string().nullable().optional(),
  billing_postal_code: z.string().nullable().optional(),
  billing_country: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  job_title: z.string().nullable().optional(),
  emergency_contacts: z.array(EmergencyContactSchema).default([]),
  custom_fields: z.record(z.string(), z.unknown()).default({}),
});
export type UserFormProfile = z.infer<typeof UserFormProfileSchema>;

export function emptyProfile(): UserFormProfile {
  return UserFormProfileSchema.parse({});
}

export async function fetchUserFormProfile(
  userId: string,
): Promise<{ ok: true; profile: UserFormProfile | null } | { ok: false; error: string }> {
  // The old bundled SECURITY DEFINER RPC accepts an arbitrary user ID and is
  // intentionally server-only. Read the owner's row through its RLS door.
  const { data, error } = await usersDb()
    .from('user_form_profile')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[matrx-extend] fetchUserFormProfile error', error.message);
    // Distinguish FAILURE from "no profile yet" — collapsing both to null
    // rendered a blank profile with zero error on a transient fetch failure,
    // looking exactly like the user's data was wiped.
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: true, profile: null };
  const parsed = UserFormProfileSchema.safeParse(data);
  if (!parsed.success) {
    console.warn('[matrx-extend] fetchUserFormProfile shape mismatch', parsed.error.format());
    return { ok: false, error: 'Profile data came back in an unexpected shape.' };
  }
  return { ok: true, profile: parsed.data };
}

export type UserFormProfilePatch = Partial<UserFormProfile>;

export async function upsertUserFormProfile(
  userId: string,
  patch: UserFormProfilePatch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // THE WRITE CARRIES ITS ORGANIZATION EXPLICITLY — the same contract as the
  // web app's /api/user/form-profile. `organization_id` is NOT NULL here and
  // no default may choose one. An existing profile keeps the organization it
  // is filed in (a save never MOVES it); a first save names the organization
  // the person is acting in, from the ONE resolver — held on the picker when
  // this device has none.
  const { data: existing, error: existingError } = await usersDb()
    .from('user_form_profile')
    .select('organization_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (existingError) {
    console.warn('[matrx-extend] upsertUserFormProfile select error', existingError.message);
    return { ok: false, error: existingError.message };
  }
  let organizationId = (existing as { organization_id?: string } | null)?.organization_id;
  if (!organizationId) {
    try {
      organizationId = await requireActiveOrganizationId();
    } catch (err) {
      if (isOrganizationNotSelectedError(err) || isOrganizationNoMembershipsError(err)) {
        return { ok: false, error: err.remedy };
      }
      throw err;
    }
  }
  const { error } = await usersDb()
    .from('user_form_profile')
    .upsert(
      { user_id: userId, ...patch, organization_id: organizationId },
      { onConflict: 'user_id' },
    );
  if (error) {
    console.warn('[matrx-extend] upsertUserFormProfile error', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
