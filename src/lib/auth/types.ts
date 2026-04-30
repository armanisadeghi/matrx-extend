import { z } from 'zod';

/**
 * Tokens as returned by Supabase /auth/v1/oauth/token.
 */
export const OAuthTokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().default('bearer'),
  expires_in: z.number().int().positive(),
  expires_at: z.number().int().positive().optional(),
});

export type OAuthTokens = z.infer<typeof OAuthTokensSchema>;

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  email_verified: z.boolean().optional(),
  full_name: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

export const SessionStateSchema = z.object({
  user: UserProfileSchema.nullable(),
  expiresAt: z.number().int().nonnegative().nullable(),
  status: z.enum(['unknown', 'signed-in', 'signed-out', 'expired']),
});

export type SessionState = z.infer<typeof SessionStateSchema>;
