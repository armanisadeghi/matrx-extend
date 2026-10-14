import { describe, expect, it } from 'vitest';
import { mayInvokeDeviceTool } from './device-invoke-gate';

const ID = 'abcdefghijklmnop';

describe('device tool invoke gate', () => {
  it("allows the extension's own page even with a tab id", () => {
    expect(
      mayInvokeDeviceTool(
        { id: ID, url: `chrome-extension://${ID}/sidepanel.html`, tab: { id: 7 } },
        ID,
      ),
    ).toBe(true);
  });
  it('allows the real side panel (no tab)', () => {
    expect(
      mayInvokeDeviceTool({ id: ID, url: `chrome-extension://${ID}/sidepanel.html` }, ID),
    ).toBe(true);
  });
  it('refuses a web page', () => {
    expect(mayInvokeDeviceTool({ id: ID, url: 'https://evil.example/', tab: { id: 7 } }, ID)).toBe(
      false,
    );
  });
  it("refuses another extension's page", () => {
    expect(
      mayInvokeDeviceTool(
        { id: 'other', url: 'chrome-extension://other/page.html', tab: { id: 1 } },
        ID,
      ),
    ).toBe(false);
  });
  it('refuses a content script (our id, web url, tab)', () => {
    expect(mayInvokeDeviceTool({ id: ID, url: 'https://example.com/', tab: { id: 3 } }, ID)).toBe(
      false,
    );
  });
});
