/** Click a visible picker target through the same browser pointer path as a user. */
export async function clickReachableShowcaseTarget(locator, kind) {
  if (kind !== 'card' && kind !== 'field') throw new Error('showcase_unknown_target_kind');
  await locator.scrollIntoViewIfNeeded();
  const position = await locator.evaluate((target) => {
    const rect = target.getBoundingClientRect();
    const bounds = {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(innerWidth, rect.right),
      bottom: Math.min(innerHeight, rect.bottom),
    };
    // The picker panel can cover the center while leaving an edge reachable.
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
  if (!position) throw new Error(`showcase_${kind}_no_reachable_pointer_point`);
  // Playwright still checks element readiness, stability, and interception at this point.
  await locator.click({ position });
}

export async function clickReachableShowcaseCard(card) {
  await clickReachableShowcaseTarget(card, 'card');
}
