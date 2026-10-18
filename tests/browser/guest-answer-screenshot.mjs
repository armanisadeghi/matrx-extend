/** Position and verify the actual answer before a native panel screenshot. */
export function prepareGuestAnswerScreenshot({ code, heading = null }) {
  const pane = [...document.querySelectorAll('button[role="tab"]')]
    .filter((tab) => tab.title === 'Chat' && tab.getAttribute('aria-selected') === 'true')
    .map((tab) => document.getElementById(tab.getAttribute('aria-controls') ?? ''))
    .find((candidate) => candidate?.getAttribute('data-state') === 'active');
  const articles = pane?.querySelectorAll(
    '[role="article"][aria-label="Assistant answer"], [role="article"][aria-label="Assistant answer, pinned"]',
  );
  const article = articles?.[articles.length - 1];
  if (!article || article.closest('[inert]')) return { eligible: false, reason: 'missing_answer' };
  article.scrollIntoView({ block: 'center', inline: 'nearest' });
  const rect = article.getBoundingClientRect();
  const style = getComputedStyle(article);
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const intersectWidth = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
  const intersectHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
  const text = [...article.querySelectorAll('[data-message-content]')]
    .map((body) => body.innerText ?? body.textContent ?? '')
    .join('\n');
  return {
    eligible:
      rect.width > 0 &&
      rect.height > 0 &&
      intersectWidth > 0 &&
      intersectHeight > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      text.includes(code) &&
      (heading === null || text.includes(heading)),
    reason: 'answer_outside_viewport_or_fixture_missing',
  };
}
