import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProcessTimes, processTimeBracket } from './startup-interval-attribution.mjs';

test('Darwin ps fractional CPU time brackets owned Chromium and host provisioner separately', () => {
  // macOS ps -o time emits centiseconds; integer-only parsing loses the real sample.
  const before = parseProcessTimes(`100 1 0:01.00 node
101 100 0:00.03 Chromium
102 101 0:00.02 Chromium Helper
900 1 0:11.00 provjobd31720568
`);
  const after = parseProcessTimes(`100 1 0:01.02 node
101 100 0:00.45 Chromium
102 101 0:00.22 Chromium Helper
900 1 0:11.31 provjobd31720568
`);
  const bracket = processTimeBracket(before, after, 100);
  assert.equal(bracket.observed.find((item) => item.pid === 101).category, 'ownedChromium');
  assert.equal(bracket.observed.find((item) => item.pid === 102).cpuSecondsDelta, 0.2);
  assert.equal(bracket.observed.find((item) => item.pid === 900).category, 'hostProvisioner');
  assert.equal(bracket.observed.find((item) => item.pid === 900).cpuSecondsDelta, 0.31);
  assert.equal(bracket.resolutionSeconds, 0.01);
});

test('new or vanished processes are reported as a gap, never fabricated as zero contribution', () => {
  const before = parseProcessTimes('100 1 0:01.00 node\n101 100 0:00.10 Chromium\n');
  const after = parseProcessTimes('100 1 0:01.01 node\n102 100 0:00.10 Chromium Helper\n');
  const bracket = processTimeBracket(before, after, 100);
  assert.deepEqual(bracket.exitedOrUnmatchedPids, [101]);
  assert.deepEqual(bracket.appearedPids, [102]);
  assert.equal(
    bracket.observed.some((item) => item.pid === 101 || item.pid === 102),
    false,
  );
});

test('positive named other-host deltas remain observable without changing ownership', () => {
  const before = parseProcessTimes(
    '100 1 0:01.00 node\n901 1 0:03.00 MTLCompilerService\n902 1 0:00.00 idle-helper\n',
  );
  const after = parseProcessTimes(
    '100 1 0:01.01 node\n901 1 0:03.82 MTLCompilerService\n902 1 0:00.00 idle-helper\n',
  );
  const bracket = processTimeBracket(before, after, 100);
  assert.deepEqual(
    bracket.observed.find((item) => item.pid === 901),
    {
      pid: 901,
      executable: 'MTLCompilerService',
      category: 'otherHost',
      cpuSecondsDelta: 0.82,
    },
  );
  assert.equal(
    bracket.observed.some((item) => item.pid === 902),
    false,
  );
  assert.equal(bracket.categoryTotalsSeconds.otherHost, 0.82);
  assert.equal(bracket.otherHostObservedProcessCount, 2);
  assert.deepEqual(bracket.ownedAtStart, [100]);
});
