/** Public CI accepts main pushes and authorized explicit dispatches; source checks follow separately. */
export function isEligibleDevelopmentCiEvent(run) {
  return run?.event === 'push' || run?.event === 'workflow_dispatch';
}
