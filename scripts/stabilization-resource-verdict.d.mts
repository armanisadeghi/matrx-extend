export type ResourceDecision = 'refused' | 'invalid' | 'child_failed' | 'valid' | 'interrupted';

export function resourceVerdict(input: {
  admitted: boolean;
  resourceInvalid: boolean;
  exitCode: number;
  childFinished?: boolean;
  operatorStopped?: boolean;
}): ResourceDecision;
