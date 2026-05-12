import { z } from 'zod';

export const DesktopHealthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  service: z.literal('matrx-local').optional(),
  user_id: z.string().nullable().optional(),
});
export type DesktopHealth = z.infer<typeof DesktopHealthSchema>;

export const DesktopRpcRequestSchema = z.object({
  command: z.string().min(1),
  args: z.record(z.unknown()).optional(),
});
export type DesktopRpcRequest = z.infer<typeof DesktopRpcRequestSchema>;

export const DesktopRpcResponseSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});
export type DesktopRpcResponse = z.infer<typeof DesktopRpcResponseSchema>;
