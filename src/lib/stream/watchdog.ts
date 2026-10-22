/**
 * MOVED to @ai-matrx/api (`createStreamWatchdog`, net/stream-watchdog). This file
 * is a door so existing imports keep working. Behavior is identical to the former
 * local copy (touch / latest-wins hold / one-shot onStall).
 */

export type { StreamWatchdog, StreamWatchdogOptions } from '@ai-matrx/api';
export { createStreamWatchdog } from '@ai-matrx/api';
