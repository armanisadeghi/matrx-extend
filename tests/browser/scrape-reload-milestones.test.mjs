import assert from 'node:assert/strict';
import test from 'node:test';
import { recordReloadMilestone } from './scrape-reload-milestones.mjs';

test('reload receipt retains the wall-clock anchor and each later boundary', () => {
  const report = { reload_milestones: [] };
  recordReloadMilestone(report, 'reload_extension', '2026-10-04T12:00:00.000Z');
  recordReloadMilestone(report, 'open_scrape_in_replacement_panel', '2026-10-04T12:00:03.000Z');
  recordReloadMilestone(report, 'observe_replacement_scrape', '2026-10-04T12:00:04.000Z');
  recordReloadMilestone(report, 'replacement_scrape_observed', '2026-10-04T12:00:05.000Z');
  assert.deepEqual(report.reload_milestones, [
    { name: 'reload_extension', at: '2026-10-04T12:00:00.000Z' },
    { name: 'open_scrape_in_replacement_panel', at: '2026-10-04T12:00:03.000Z' },
    { name: 'observe_replacement_scrape', at: '2026-10-04T12:00:04.000Z' },
    { name: 'replacement_scrape_observed', at: '2026-10-04T12:00:05.000Z' },
  ]);
  assert.throws(() => recordReloadMilestone(report, 'reload_extension'), /out_of_order/);
});

test('interrupted replacement preserves the reload start without fabricating completion', () => {
  const report = { reload_milestones: [] };
  recordReloadMilestone(report, 'reload_extension', '2026-10-04T13:00:00.000Z');
  recordReloadMilestone(report, 'open_scrape_in_replacement_panel', '2026-10-04T13:00:08.000Z');
  assert.throws(() => recordReloadMilestone(report, 'replacement_scrape_observed'), /out_of_order/);
  assert.deepEqual(report.reload_milestones, [
    { name: 'reload_extension', at: '2026-10-04T13:00:00.000Z' },
    { name: 'open_scrape_in_replacement_panel', at: '2026-10-04T13:00:08.000Z' },
  ]);
});
