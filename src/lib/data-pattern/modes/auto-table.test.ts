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

  it('repeats a rowspan cell down the rows it spans and skips empty rows', () => {
    document.body.innerHTML = `<table><thead><tr><th>Year</th><th>Name</th><th>Country</th></tr></thead><tbody>
      <tr><td rowspan="2">1902</td><td>Hendrik Lorentz</td><td>Netherlands</td></tr>
      <tr><td>Pieter Zeeman</td><td>Netherlands</td></tr>
      <tr><td></td><td></td><td></td></tr>
      <tr><td>1903</td><td colspan="2">Henri Becquerel, France</td></tr>
    </tbody></table>`;
    const rows = autoTableMode.runInPage({ table_index: 0 }) as Array<Record<string, string>>;
    expect(rows).toEqual([
      { Year: '1902', Name: 'Hendrik Lorentz', Country: 'Netherlands' },
      { Year: '1902', Name: 'Pieter Zeeman', Country: 'Netherlands' },
      { Year: '1903', Name: 'Henri Becquerel, France', Country: 'Henri Becquerel, France' },
    ]);
  });

  it('reads the value of a form control inside a cell', () => {
    document.body.innerHTML = `<table><thead><tr><th>Memory</th><th>Disk</th></tr></thead><tbody>
      <tr><td>1 GiB</td><td><label>GiB</label><input type="number" value="10"></td></tr>
      <tr><td>2 GiB</td><td><select><option>30 GiB</option><option selected>60 GiB</option></select></td></tr>
    </tbody></table>`;
    const rows = autoTableMode.runInPage({ table_index: 0 }) as Array<Record<string, string>>;
    expect(rows).toEqual([
      { Memory: '1 GiB', Disk: 'GiB 10' },
      { Memory: '2 GiB', Disk: '60 GiB' },
    ]);
  });
});
