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
