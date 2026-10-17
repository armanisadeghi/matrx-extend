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

type Run = { rows: Array<Record<string, string>>; notice?: string; signature?: unknown };
const run = (cfg: Record<string, unknown>): Run => {
  const out = autoTableMode.runInPage(cfg as never) as unknown;
  return Array.isArray(out) ? { rows: out } : (out as Run);
};

const FILMS = `<h2>Box office</h2><table id="films"><caption>Films</caption><thead><tr><th>Rank</th><th>Title</th><th>Gross</th></tr></thead><tbody>
  <tr><td>1</td><td>Film A</td><td>$10</td></tr><tr><td>2</td><td>Film B</td><td>$5</td></tr></tbody></table>`;
const PLANETS = `<h2>Planets</h2><table><thead><tr><th>Planet</th><th>Moons</th></tr></thead><tbody>
  <tr><td>Earth</td><td>1</td></tr><tr><td>Mars</td><td>2</td></tr></tbody></table>`;

describe('Tables — a saved table is found by what it is, not where it sits', () => {
  it('still captures the same table after another table is inserted above it', () => {
    document.body.innerHTML = PLANETS + FILMS; // films is table #1 when saved
    const saved = run({ table_index: 1, describe_only: true }).signature;
    expect(saved).toMatchObject({ headers: ['rank', 'title', 'gross'], caption: 'films' });

    // The page now has a new table on top: films moves to index 2.
    document.body.innerHTML = `<table><thead><tr><th>Name</th><th>Age</th></tr></thead><tbody>
      <tr><td>Ann</td><td>3</td></tr><tr><td>Bo</td><td>4</td></tr></tbody></table>${PLANETS}${FILMS}`;
    const out = run({ table_index: 1, signature: saved });
    expect(out.rows[0]).toEqual({ Rank: '1', Title: 'Film A', Gross: '$10' });
    expect(out.notice).toBeUndefined();
  });

  it('survives changed data and an extra row', () => {
    document.body.innerHTML = FILMS;
    const saved = run({ table_index: 0, describe_only: true }).signature;
    document.body.innerHTML = FILMS.replace('Film A', 'Film Z').replace(
      '</tbody>',
      '<tr><td>3</td><td>Film C</td><td>$1</td></tr></tbody>',
    );
    const out = run({ table_index: 0, signature: saved });
    expect(out.rows.map((r) => r.Title)).toEqual(['Film Z', 'Film B', 'Film C']);
  });

  it('announces a missing table instead of capturing a different one', () => {
    document.body.innerHTML = FILMS;
    const saved = run({ table_index: 0, describe_only: true }).signature;
    document.body.innerHTML = PLANETS;
    const out = run({ table_index: 0, signature: saved });
    expect(out.rows).toEqual([]);
    expect(out.notice).toMatch(/not found/i);
  });

  it('announces a weak match', () => {
    document.body.innerHTML = FILMS;
    const saved = run({ table_index: 0, describe_only: true }).signature;
    document.body.innerHTML = `<h2>Other</h2><table><thead><tr><th>Rank</th><th>Title</th><th>Gross</th><th>Team</th></tr></thead><tbody>
      <tr><td>1</td><td>X</td><td>9</td><td>T</td></tr><tr><td>2</td><td>Y</td><td>8</td><td>U</td></tr></tbody></table>`;
    const out = run({ table_index: 0, signature: saved });
    expect(out.notice).toMatch(/closest match/i);
  });

  it('breaks a tie between look-alike tables by position and says so', () => {
    const t = (n: string) =>
      `<table><thead><tr><th>Year</th><th>Name</th></tr></thead><tbody><tr><td>1</td><td>${n}1</td></tr><tr><td>2</td><td>${n}2</td></tr></tbody></table>`;
    document.body.innerHTML = t('a') + t('b');
    const saved = run({ table_index: 1, describe_only: true }).signature;
    const out = run({ table_index: 1, signature: saved });
    expect(out.rows[0]?.Name).toBe('b1');
    expect(out.notice).toMatch(/by position/i);
  });

  it('a pattern saved without a signature still runs by index', () => {
    document.body.innerHTML = PLANETS + FILMS;
    expect(run({ table_index: 1 }).rows[0]?.Title).toBe('Film A');
  });
});
