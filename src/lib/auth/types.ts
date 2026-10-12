import { z } from 'zod';

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
