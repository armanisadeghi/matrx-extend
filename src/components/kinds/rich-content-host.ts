/**
 * THE extension's registration with @ai-matrx/rich-content — imported once, for its side effect,
 * by the side panel entry. Without it every kind in a chat reply rendered through the package's
 * bare host (a plain value) and the package said so in the console on every panel open.
 *
 * The content IR host is the same one the extension's own kind views use (`./host`).
 */
import { configureRichContent } from '@ai-matrx/rich-content/host';
import { contentIrHost } from './host';

configureRichContent({ contentIrHost });
