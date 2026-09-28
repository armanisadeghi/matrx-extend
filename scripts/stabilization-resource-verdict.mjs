// The wrapper exit code is the child code after admission, so it cannot by
// itself say whether a resource permit was denied or a permitted job failed.
export function resourceVerdict({ admitted, resourceInvalid, exitCode, childFinished, operatorStopped }) {
  if (resourceInvalid) return 'invalid';
  if (!admitted) return 'refused';
  if (exitCode === 0) return 'valid';
  if (childFinished) return 'child_failed';
  if (operatorStopped) return 'interrupted';
  return 'invalid';
}
