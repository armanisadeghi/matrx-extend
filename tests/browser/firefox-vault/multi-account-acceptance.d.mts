/** Read-only DOM selector shared by the real Firefox runner and component regression. */
export function selectUpdateSelector(
  document: Document,
  expected: ReadonlyArray<{ primary: string; secondary: string }>,
): string | null;
