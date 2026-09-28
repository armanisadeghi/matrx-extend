import { rowsToTsv, stringifyJson, wrapJsonForAgent } from '@/lib/clipboard/copy';
import { describe, expect, it } from 'vitest';

describe('Showcase saved-result copy formatters', () => {
  it('preserves long, distinct extracted values in JSON and AI copy', () => {
    // Regression: a long event description previously became a 50,000-char preview.
    const details = 'Doors at 8 pm. Accessible entrance on Main Street. '.repeat(1_100);
    const rows = [
      { event_title: 'Harbor Jazz Friday', details },
      { event_title: 'Sunday Matinee', details: `${details}Matinee seating is reserved.` },
    ];

    expect(JSON.parse(stringifyJson(rows))).toEqual(rows);
    const aiCopy = wrapJsonForAgent(rows, { description: 'calendar events' });
    const fenced = aiCopy.match(/```json\n([\s\S]*?)\n```/);
    expect(fenced?.[1]).toBeDefined();
    expect(JSON.parse(fenced?.[1] ?? '')).toEqual(rows);
  });

  it('refuses cyclic or unsupported JSON instead of returning a success-looking substitute', () => {
    const cyclic: Record<string, unknown> = { event_title: 'Harbor Jazz Friday' };
    cyclic.related_event = cyclic;

    expect(() => stringifyJson(cyclic)).toThrow('Could not copy JSON');
    expect(() => stringifyJson({ event_title: 'Sunday Matinee', seats: 12n })).toThrow(
      'Could not copy JSON',
    );
  });

  it('keeps spreadsheet TSV headers and cells distinct when they contain tabs, newlines, or quotes', () => {
    // Regression: replacing separators with spaces collapsed different event values.
    const rows = [
      {
        event_title: 'Harbor Jazz Friday',
        'venue\tzone': 'Pier 7\tNorth',
        notes: 'Doors\nat 8 pm',
        quote: 'He said "welcome".',
      },
      {
        event_title: 'Sunday Matinee',
        'venue\tzone': 'Pier 7 North',
        notes: 'Doors at 8 pm',
        quote: 'No quote',
      },
    ];

    const tsv = rowsToTsv(rows);
    expect(tsv).toBe(
      'event_title\t"venue\tzone"\tnotes\tquote\n' +
        'Harbor Jazz Friday\t"Pier 7\tNorth"\t"Doors\nat 8 pm"\t"He said ""welcome""."\n' +
        'Sunday Matinee\tPier 7 North\tDoors at 8 pm\tNo quote',
    );
    expect(readQuotedTsv(tsv)).toEqual([
      ['event_title', 'venue\tzone', 'notes', 'quote'],
      ['Harbor Jazz Friday', 'Pier 7\tNorth', 'Doors\nat 8 pm', 'He said "welcome".'],
      ['Sunday Matinee', 'Pier 7 North', 'Doors at 8 pm', 'No quote'],
    ]);
  });
});

/** Spreadsheet-style reader used only to check that encoded fields round-trip. */
function readQuotedTsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input.charAt(i);
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === '\t' && !quoted) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' && !quoted) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}
