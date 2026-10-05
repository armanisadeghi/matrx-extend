/** Click the intended card through the same browser pointer path as a user. */
export async function clickReachableShowcaseCard(card) {
  await card.scrollIntoViewIfNeeded();
  const position = await card.evaluate((target) => {
    const rect = target.getBoundingClientRect();
    const bounds = {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(innerWidth, rect.right),
      bottom: Math.min(innerHeight, rect.bottom),
    };
    // The picker panel can cover the center while leaving a card edge reachable.
    // Check the browser's actual topmost hit before asking Playwright to click.
    for (const fy of [0.5, 0.25, 0.75]) {
      for (const fx of [0.5, 0.25, 0.75]) {
        const x = bounds.left + (bounds.right - bounds.left) * fx;
        const y = bounds.top + (bounds.bottom - bounds.top) * fy;
        if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === target || target.contains(hit)))
          return { x: x - rect.left, y: y - rect.top };
      }
    }
    return null;
  });
  if (!position) throw new Error('showcase_card_no_reachable_pointer_point');
  // Playwright still checks visibility, stability, and interception at this point.
  await card.click({ position });
}
