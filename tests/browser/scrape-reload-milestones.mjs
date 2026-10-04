import assert from 'node:assert/strict';

const PHASES = [
  'reload_extension',
  'open_scrape_in_replacement_panel',
  'observe_replacement_scrape',
  'replacement_scrape_observed',
];

export function recordReloadMilestone(report, phase, timestamp = new Date().toISOString()) {
  assert.equal(phase, PHASES[report.reload_milestones.length], 'reload_milestone_out_of_order');
  report.reload_milestones.push({ name: phase, at: timestamp });
}
