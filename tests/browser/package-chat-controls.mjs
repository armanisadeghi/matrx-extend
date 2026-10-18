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
  let toolCardCount = 0;
  let toolOnlyArticleCount = 0;
  let assistantArticleCount = 0;
  const answers = active
    ? [
        ...pane.querySelectorAll(
          '[role="article"][aria-label="Assistant answer"], [role="article"][aria-label="Assistant answer, pinned"]',
        ),
      ]
        .filter(visible)
        .map((article) => {
          assistantArticleCount += 1;
          const text = [...article.querySelectorAll('[data-message-content]')]
            .map((body) => {
              // The real package wraps live/persisted tool UI in group/toolcard INSIDE the answer body.
              const copy = body.cloneNode(true);
              const originalNodes = [...body.querySelectorAll('*')];
              const copiedNodes = [...copy.querySelectorAll('*')];
              originalNodes.forEach((node, index) => {
                const style = getComputedStyle(node);
                const tool = node.classList.contains('group/toolcard');
                if (tool) toolCardCount += 1;
                if (
                  tool ||
                  node.matches('[data-testid="tool-line"], [hidden], [aria-hidden="true"]') ||
                  style.display === 'none' ||
                  style.visibility === 'hidden'
                )
                  copiedNodes[index]?.remove();
              });
              return (copy.innerText ?? copy.textContent ?? '').trim();
            })
            .filter(Boolean)
            .join('\n');
          if (!text && article.querySelector('[class~="group/toolcard"]'))
            toolOnlyArticleCount += 1;
          return text;
        })
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
    assistantDom: { assistantArticleCount, toolCardCount, toolOnlyArticleCount },
  };
}
