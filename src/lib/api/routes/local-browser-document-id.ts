import { z } from 'zod';

/** Opaque browser-native identity; bounded for private transport only. */
export const localBrowserDocumentId = z.string().refine(
  (value) => {
    const bytes = new TextEncoder().encode(value).byteLength;
    return bytes > 0 && bytes <= 128;
  },
  { message: 'invalid local browser document id' },
);
