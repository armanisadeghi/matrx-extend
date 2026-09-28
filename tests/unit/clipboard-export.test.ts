import { stringifyJson, wrapJsonForAgent } from '@/lib/clipboard/copy';
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
    cyclic['related_event'] = cyclic;

    expect(() => stringifyJson(cyclic)).toThrow('Could not copy JSON');
    expect(() => stringifyJson({ event_title: 'Sunday Matinee', seats: 12n })).toThrow(
      'Could not copy JSON',
    );
  });
});
