/** Compare persisted image pixels with the viewport measured inside the owned page. */
export function matchesFullPageAspect(row, metrics) {
  if (
    !(row?.width > 0) ||
    !(row?.height > row.width) ||
    !(metrics?.innerWidth > 0) ||
    !(metrics?.scrollHeight > 0)
  )
    return false;
  return Math.abs(row.width / row.height - metrics.innerWidth / metrics.scrollHeight) <= 0.08;
}
