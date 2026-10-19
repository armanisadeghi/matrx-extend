/** The active browser tab must still be the exact demo document before either Chat send. */
export async function sendMemberChatOnTarget({ web, panel, evaluate, expectedUrl, marker, send }) {
  if (web.isClosed() || web.url() !== expectedUrl)
    throw new Error('reviewer_chat_target_unverified');
  const assigned = await evaluate(
    panel,
    `(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length !== 1 || !Number.isInteger(tabs[0]?.id)) return null;
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => ({
          url: location.origin + location.pathname,
          marker: document.documentElement.getAttribute('data-matrx-reviewer-target'),
        }),
      });
      return result?.result ?? null;
    })()`,
  ).catch(() => null);
  if (assigned?.url !== expectedUrl || assigned?.marker !== marker)
    throw new Error('reviewer_chat_target_unverified');
  await send();
}
