/**
 * THE ONE PLATFORM TOKEN for this client.
 *
 * `content_ir.kind_component.platform` is a CHECK-constrained vocabulary
 * (`web | vite | react-native | chrome-extension | desktop | html-js`). This
 * extension resolves as `chrome-extension`, and a host that lies here renders
 * the wrong component everywhere — the side panel would silently draw
 * components authored for a 1200px web page.
 *
 * React-free on purpose: the stream reducer imports it without pulling React in.
 */
export const CONTENT_IR_PLATFORM = 'chrome-extension' as const;
