import { describe, expect, it } from 'vitest';
import { parsePanelSavedLoginStatus } from '../../src/lib/credentials/panel-saved-login-status';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const ready = () => ({
  status: 'ready',
  offerId: 'a'.repeat(36),
  itemIds: [first, second],
  matches: [
    { item_id: first, display_name: 'First account' },
    { item_id: second, display_name: 'Second account' },
  ],
  pageUrl: 'https://child.example/login',
  frameId: 3,
});

describe('saved-login panel metadata boundary', () => {
  it('preserves the exact target and both canonical account labels without sharing mutable arrays', () => {
    const input = ready();
    const parsed = parsePanelSavedLoginStatus(input);
    expect(parsed).toEqual(input);
    input.itemIds.reverse();
    input.matches.splice(0, 1, { item_id: first, display_name: 'Changed' });
    expect(parsed).toEqual(ready());
  });

  it.each(['none', 'disabled'])('accepts an explicit empty %s state', (status) => {
    expect(parsePanelSavedLoginStatus({ status, itemIds: [] })).toEqual({ status, itemIds: [] });
  });

  it.each([
    ['missing reply', undefined],
    ['missing exact offer', { ...ready(), offerId: undefined }],
    ['UUID instead of generated offer', { ...ready(), offerId: first }],
    ['missing frame', { ...ready(), frameId: undefined }],
    ['negative frame', { ...ready(), frameId: -1 }],
    ['fractional frame', { ...ready(), frameId: 1.5 }],
    ['duplicate account IDs', { ...ready(), itemIds: [first, first] }],
    [
      'duplicate matched accounts',
      { ...ready(), matches: [ready().matches[0], ready().matches[0]] },
    ],
    [
      'mismatched account',
      { ...ready(), matches: [{ item_id: first, display_name: 'First account' }] },
    ],
    [
      'unexpected secret field',
      {
        ...ready(),
        matches: [{ ...ready().matches[0], password: 'forbidden' }, ready().matches[1]],
      },
    ],
    ['empty ready accounts', { ...ready(), itemIds: [], matches: [] }],
    ['unsafe URL', { ...ready(), pageUrl: 'http://child.example/login' }],
    ['URL credentials', { ...ready(), pageUrl: 'https://user:password@child.example/login' }],
    ['URL query', { ...ready(), pageUrl: 'https://child.example/login?session=private' }],
    ['URL fragment', { ...ready(), pageUrl: 'https://child.example/login#private' }],
    [
      'extra target on none',
      { status: 'none', itemIds: [], pageUrl: 'https://child.example/login' },
    ],
    ['nonempty disabled', { status: 'disabled', itemIds: [first] }],
  ])('removes all actionable metadata for %s', (_name, input) => {
    expect(parsePanelSavedLoginStatus(input)).toEqual({ status: 'unavailable', itemIds: [] });
  });
});
