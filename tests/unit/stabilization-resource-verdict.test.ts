import { describe, expect, it } from 'vitest';
import { resourceVerdict } from '../../scripts/stabilization-resource-verdict.mjs';

describe('stabilization resource terminal verdict', () => {
  it.each([
    ['launch denied before admission', { admitted: false, resourceInvalid: false, exitCode: 2 }, 'refused'],
    ['journal failure before admission', { admitted: false, resourceInvalid: true, exitCode: 3 }, 'refused'],
    ['unsafe admitted run', { admitted: true, resourceInvalid: true, exitCode: 3, childFinished: true }, 'invalid'],
    ['admitted compiler failure', { admitted: true, resourceInvalid: false, exitCode: 1, childFinished: true }, 'child_failed'],
    ['successful admitted command', { admitted: true, resourceInvalid: false, exitCode: 0, childFinished: true }, 'valid'],
    ['operator stopped command', { admitted: true, resourceInvalid: false, exitCode: 130, operatorStopped: true }, 'interrupted'],
    ['guard failed after admission', { admitted: true, resourceInvalid: false, exitCode: 2 }, 'invalid'],
  ])('%s', (_case, input, expected) => {
    expect(resourceVerdict(input)).toBe(expected);
  });
});
