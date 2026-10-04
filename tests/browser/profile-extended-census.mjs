const REQUIRED = {
  member: ['EXT-F-1004-T05', 'EXT-F-1004-T17', 'EXT-F-1004-T21'],
  admin: ['EXT-F-1004-T06', 'EXT-F-1004-T18', 'EXT-F-1004-T22'],
};
const DIMENSIONS = ['warm', 'extension_reload'];
const EXTENDED_IDS = new Set(Object.values(REQUIRED).flat());

export function extendedCaseCensus(cases, modes = ['member', 'admin']) {
  const expected = modes.flatMap((mode) =>
    (REQUIRED[mode] ?? []).flatMap((id) =>
      DIMENSIONS.map((dimension) => ({ id, mode, dimension })),
    ),
  );
  const observed = cases.filter((entry) => EXTENDED_IDS.has(entry.id));
  const cells = expected.map((cell) => {
    const matches = observed.filter(
      (entry) =>
        entry.id === cell.id && entry.mode === cell.mode && entry.dimension === cell.dimension,
    );
    return {
      ...cell,
      status: matches.length === 1 ? matches[0].status : matches.length ? 'duplicate' : 'missing',
    };
  });
  const known = new Set(expected.map(({ id, mode, dimension }) => `${id}:${mode}:${dimension}`));
  const unexpected = observed
    .filter((entry) => !known.has(`${entry.id}:${entry.mode}:${entry.dimension}`))
    .map(({ id, mode, dimension, status }) => ({ id, mode, dimension, status }));
  return {
    expected_count: expected.length,
    cells,
    unexpected,
    complete: cells.every((cell) => cell.status === 'passed') && unexpected.length === 0,
  };
}
