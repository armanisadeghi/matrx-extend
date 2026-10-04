// This function is serialized into the native panel evaluation; keep it self-contained.
export function observeScrapeRows(content) {
  const hasRemove = (anchor, kind) =>
    [...(anchor.parentElement?.querySelectorAll('button') ?? [])].some(
      (button) =>
        (button.getAttribute('title') ?? button.getAttribute('data-matrx-title')) ===
        `Remove ${kind}`,
    );
  return {
    imageItems: [...content.querySelectorAll('a')]
      .filter((a) => a.querySelector('img'))
      .map((a) => ({
        href: a.href,
        src: a.querySelector('img')?.src ?? null,
        alt: a.querySelector('img')?.getAttribute('alt') ?? null,
        complete: a.querySelector('img')?.complete === true,
        naturalWidth: a.querySelector('img')?.naturalWidth ?? 0,
        naturalHeight: a.querySelector('img')?.naturalHeight ?? 0,
      })),
    videoItems: [...content.querySelectorAll('a')]
      .filter((a) => hasRemove(a, 'video'))
      .map((a) => ({ href: a.href, text: a.textContent?.trim() ?? '' })),
    linkItems: [...content.querySelectorAll('a')]
      .filter((a) => hasRemove(a, 'link'))
      .map((a) => ({ href: a.href, text: a.firstElementChild?.textContent?.trim() ?? '' })),
  };
}
