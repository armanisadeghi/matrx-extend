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

/** Read-only DOM selector for the three username-eligible VaultView Fill choices. */
export function selectEligibleFillSelector(
  document: Document,
  expected: ReadonlyArray<string>,
): string | null;

export function eligibleFillDiagnostic(
  document: Document,
  expected: ReadonlyArray<string>,
): {
  expectedCount: number;
  fillRowCount: number;
  uniqueLabelCount: number;
  expectedLabelMatched: boolean[];
};
