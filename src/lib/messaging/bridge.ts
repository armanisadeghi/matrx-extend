/**
 * Thin typed wrapper around webext-bridge.
 *
 * webext-bridge handles SW ↔ side panel ↔ content ↔ popup ↔ offscreen routing
 * with one API. We add Zod validation so payload shape mismatches scream
 * immediately rather than corrupting state silently.
 *
 * NOTE: webext-bridge types payloads as JsonValue, which TypeScript can't
 * structurally match against arbitrary objects without index signatures.
 * Our wrappers cast through `unknown` at the boundary; runtime is JSON-safe
 * because messages are serialized before postMessage.
 */

import { onMessage as bridgeOnMessage, sendMessage as bridgeSend } from 'webext-bridge/background';
import type { z } from 'zod';

type Destination =
  | 'background'
  | 'popup'
  | 'options'
  | 'sidepanel'
  | 'content-script'
  | 'devtools'
  | 'window'
  | `content-script@${number}`
  | `window@${number}`;

export async function send<TReq, TRes>(
  channel: string,
  payload: TReq,
  destination: Destination,
): Promise<TRes> {
  return (await bridgeSend(channel as never, payload as never, destination as never)) as TRes;
}

export function on<TReq, TRes>(
  channel: string,
  handler: (req: TReq, sender: { sender: { tab?: { id?: number } } }) => Promise<TRes> | TRes,
): void {
  bridgeOnMessage(channel as never, async (msg: { data: unknown }) => {
    return (await handler(msg.data as TReq, msg as never)) as never;
  });
}

/**
 * Validate-then-handle: rejects any payload that doesn't match the schema.
 * Use this in all SW handlers — clients can be evil.
 */
export function onValidated<TReq, TRes>(
  channel: string,
  schema: z.ZodType<TReq>,
  handler: (req: TReq, sender: { sender: { tab?: { id?: number } } }) => Promise<TRes> | TRes,
): void {
  on<unknown, TRes>(channel, async (raw, sender) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[matrx-extend] payload rejected on ${channel}`, parsed.error.format());
      throw new Error(`Invalid payload on ${channel}`);
    }
    return handler(parsed.data, sender);
  });
}
