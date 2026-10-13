export function ownedScreenshotCardMatches(rows, owned, card) {
  return (
    Array.isArray(rows) &&
    rows.length === 1 &&
    rows[0]?.id === owned?.id &&
    rows[0]?.file_id === owned?.file_id &&
    card?.cardCount === 1 &&
    card.ordered === true &&
    card.distinct === true
  );
}

// Called once after the restored card times out. The runner supplies its
// trusted Refresh click and fresh network/DOM reads; no row values escape.
export async function discriminateRestoredScreenshotCard({
  clickRefresh,
  readRows,
  cardForRows,
  owned,
}) {
  await clickRefresh();
  const read = await readRows();
  const card = await cardForRows(read.rows);
  const ownedRowCount = read.rows.filter(
    (row) => row.id === owned.id && row.file_id === owned.file_id,
  ).length;
  const ownedRow = read.rows.length === 1 && ownedRowCount === 1;
  return {
    clicked: true,
    completedRead: true,
    readElapsedMs: Math.round(read.completedAt - read.startedAt),
    readRowCount: read.rows.length,
    ownedRowCount,
    ownedRow,
    cardCount: card.cardCount,
    cardMatched: ownedRow && ownedScreenshotCardMatches(read.rows, owned, card),
    card,
  };
}
