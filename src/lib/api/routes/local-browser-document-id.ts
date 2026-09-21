import { z } from 'zod';

/** Opaque browser-native identity; bounded for private transport only. */
export const localBrowserDocumentId = z.string().refine(
  (value) => {
    const encoded = new TextEncoder().encode(value);
    // TextEncoder replaces lone surrogates; opaque IDs must round-trip exactly.
    return (
      new TextDecoder().decode(encoded) === value &&
      encoded.byteLength > 0 &&
      encoded.byteLength <= 128
    );
  },
  { message: 'invalid local browser document id' },
);
