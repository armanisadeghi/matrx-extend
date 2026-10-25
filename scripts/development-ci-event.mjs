/** Public CI accepts main pushes and authorized explicit dispatches; source checks follow separately. */
export function isEligibleDevelopmentCiEvent(run) {
  return run?.event === 'push' || run?.event === 'workflow_dispatch';
}

/** A completed main CI run is identified by its workflow path and provenance, not its display name. */
export function isSuccessfulDevelopmentCiRun(run) {
  return (
    run?.path === '.github/workflows/ci.yml' &&
    isEligibleDevelopmentCiEvent(run) &&
    run.head_branch === 'main' &&
    run.status === 'completed' &&
    run.conclusion === 'success' &&
    /^[a-f0-9]{40}$/.test(run.head_sha ?? '') &&
    Number.isSafeInteger(run.run_attempt) &&
    run.run_attempt > 0
  );
}
