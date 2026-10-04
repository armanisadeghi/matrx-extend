// The wrapper exit code is the child code after admission, so it cannot by
// itself say whether a resource permit was denied or a permitted job failed.
export function resourceVerdict({
  admitted,
  resourceInvalid,
  cpuPending = false,
  exitCode,
  childFinished,
  operatorStopped,
}) {
  if (!admitted) return 'refused';
  if (resourceInvalid || cpuPending) return 'invalid';
  if (exitCode === 0) return 'valid';
  if (childFinished) return 'child_failed';
  if (operatorStopped) return 'interrupted';
  return 'invalid';
}
