import { describe, expect, it } from 'vitest';
import { computersOnlyFilter, isComputerPlatform } from './computers';

const excluded = ['web', 'chrome-extension', 'server'];

describe('only computers', () => {
  it('excludes web, server and chrome-extension rows; keeps computers and legacy NULL platform', () => {
    expect(isComputerPlatform('web', excluded)).toBe(false);
    expect(isComputerPlatform('server', excluded)).toBe(false);
    expect(isComputerPlatform('chrome-extension', excluded)).toBe(false);
    expect(isComputerPlatform('darwin', excluded)).toBe(true);
    expect(isComputerPlatform(null, excluded)).toBe(true);
  });
  it('builds the filter from the knob-provided set', () => {
    expect(computersOnlyFilter(excluded)).toBe(
      'platform.is.null,platform.not.in.(web,chrome-extension,server)',
    );
    expect(computersOnlyFilter(['web'])).toBe('platform.is.null,platform.not.in.(web)');
  });
});
