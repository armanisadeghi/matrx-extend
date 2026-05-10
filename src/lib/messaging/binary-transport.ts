/**
 * Base64 transport for binary payloads sent over `chrome.runtime.sendMessage`.
 *
 * MV3's cross-context messaging uses **JSON serialization**, NOT structured
 * clone. ArrayBuffer / Uint8Array / Blob handed to `sendMessage` get coerced
 * to `{}` (or worse — `"[object Object]"` after a stringify hop), which means
 * audio chunks broadcast at ~50 KB arrive at the receiver as ~15 bytes of
 * garbage. Whisper then transcribes silence; video uploads land as empty
 * webm files.
 *
 * Fix: encode binary as base64 strings before broadcast, decode on receive.
 * Base64 is JSON-safe and lossless. The size overhead is ~4/3 of the original
 * payload — acceptable for chunks that are already small (audio: 30–60 KB,
 * video: a few MB once a recording stops).
 *
 * Usage:
 *   - Sender: `await blobToBase64(blob)` → string → broadcast
 *   - Receiver: `base64ToBlob(str, mimeType)` or `base64ToArrayBuffer(str)`
 *
 * Implementation notes:
 *   - `blobToBase64` uses FileReader (`readAsDataURL`) so it handles arbitrarily
 *     large buffers without the `String.fromCharCode(...u8)` stack-overflow
 *     trap that bites every "naive" base64 encoder for buffers > ~100 KB.
 *   - `base64ToBlob` uses `atob` + a typed-array fill loop. The loop is
 *     bounded by string length, never recursive, never allocates more than
 *     one Uint8Array — safe for any size we'd realistically push through
 *     the message channel.
 */

/** Encode a Blob's bytes to a base64 string (no `data:` prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader did not produce a string result'));
        return;
      }
      // readAsDataURL returns "data:<mime>;base64,<payload>" — strip the
      // prefix so receivers can decode without parsing the data URL.
      const comma = result.indexOf(',');
      resolve(comma === -1 ? '' : result.slice(comma + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/** Encode an ArrayBuffer to a base64 string. */
export async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  return blobToBase64(new Blob([buffer]));
}

/** Decode a base64 string back into a Blob with the given mime type. */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binStr = atob(base64);
  const len = binStr.length;
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) u8[i] = binStr.charCodeAt(i);
  return new Blob([u8], { type: mimeType });
}

/** Decode a base64 string back into a fresh ArrayBuffer. */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binStr = atob(base64);
  const len = binStr.length;
  const buffer = new ArrayBuffer(len);
  const u8 = new Uint8Array(buffer);
  for (let i = 0; i < len; i++) u8[i] = binStr.charCodeAt(i);
  return buffer;
}
