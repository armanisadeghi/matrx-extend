/** Native observations for the package Chat surface, scoped to its active tab pane. */
export function readPackageChatControls(pane) {
  const visible = (element) => {
    if (!element || element.closest('[inert]')) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    );
  };
  const active = pane?.getAttribute('data-state') === 'active' && visible(pane);
  const sends = active
    ? [...pane.querySelectorAll('button[aria-label="Send message"]')].filter(visible)
    : [];
  const answers = active
    ? [
        ...pane.querySelectorAll(
          '[role="article"][aria-label="Assistant answer"], [role="article"][aria-label="Assistant answer, pinned"]',
        ),
      ]
        .map((article) =>
          [...article.querySelectorAll('[data-message-content]')]
            .map((body) => body.innerText ?? body.textContent ?? '')
            .join('\n'),
        )
        .filter((text) => text.trim().length > 0)
    : [];
  return {
    sendEnabled:
      sends.length === 1 && !sends[0].disabled && sends[0].getAttribute('aria-disabled') !== 'true',
    sendControlCount: sends.length,
    sendControlDisabled:
      sends.length === 1
        ? sends[0].disabled || sends[0].getAttribute('aria-disabled') === 'true'
        : null,
    streaming:
      active && [...pane.querySelectorAll('button[aria-label="Stop the run"]')].some(visible),
    replies: answers,
  };
}
