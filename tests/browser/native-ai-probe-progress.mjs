const CYCLES = new Set(['warm', 'post_reload']);
const STEPS = new Set([
  'open_tools',
  'catalog_ready',
  'surface_filter',
  'internal_delegates',
  ...['availability', 'summarize'].flatMap((tool) =>
    ['search', 'row', 'expand', 'form', 'arguments', 'run', 'result', 'parse'].map(
      (step) => `${tool}_${step}`,
    ),
  ),
]);

/** Only fixed stage names enter the report; never preserve thrown UI text. */
export function markNativeAiManualStep(report, cycle, step) {
  if (!CYCLES.has(cycle) || !STEPS.has(step)) throw new Error('native_ai_manual_stage_invalid');
  report.stage = `${cycle}_manual_${step}`;
  report.manual_boundary = { cycle, step, outcome: 'entered' };
}

export function completeNativeAiManualStep(report) {
  if (report.manual_boundary?.outcome === 'entered') report.manual_boundary.outcome = 'complete';
}

export function failNativeAiManualStep(report) {
  const boundary = report.manual_boundary;
  if (!CYCLES.has(boundary?.cycle) || !STEPS.has(boundary?.step) || boundary.outcome !== 'entered')
    return null;
  boundary.outcome = 'failed';
  return `native_ai_${boundary.cycle}_manual_${boundary.step}_failed`;
}
