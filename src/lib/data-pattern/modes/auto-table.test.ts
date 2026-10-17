import { afterEach, describe, expect, it } from 'vitest';
import { autoTableMode } from './auto-table';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Tables — header rows', () => {
  it('a header row inside <tbody> (no <thead>) is not also a data row', () => {
    document.body.innerHTML = `<table><tbody>
      <tr><th>Rank</th><th>Release</th><th>Gross</th></tr>
      <tr><td>1</td><td>Film A</td><td>$10</td></tr>
      <tr><td>2</td><td>Film B</td><td>$5</td></tr>
    </tbody></table>`;
    const rows = autoTableMode.runInPage({ table_index: 0 }) as Array<Record<string, string>>;
    expect(rows).toEqual([
      { Rank: '1', Release: 'Film A', Gross: '$10' },
      { Rank: '2', Release: 'Film B', Gross: '$5' },
    ]);
  });
});
