/** Read-only DOM selector shared by the real Firefox runner and component regression. */
export function selectUpdateSelector(
  document: Document,
  expected: ReadonlyArray<{ primary: string; secondary: string }>,
): string | null;

export function updateChoiceDiagnostic(
  document: Document,
  expected: ReadonlyArray<{ primary: string; secondary: string }>,
): {
  headingCount: number;
  visibleHeadingCount: number;
  updateCount: number;
  saveAsNewCount: number;
  choices: Array<{
    spanCount: number;
    disabled: boolean;
    primaryMatches: boolean[];
    secondaryMatches: boolean[];
  }>;
};
