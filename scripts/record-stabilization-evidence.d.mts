export type EvidenceSource = {
  guard_log_path: string;
  guard_log_sha256: string;
  raw_result_path: string;
  raw_result_sha256: string;
};

export type EvidenceRecord = {
  schema_version: 1;
  run_id: string;
  source: EvidenceSource;
  guard: {
    admitted_at: string;
    child_exit_at: string;
    child_exit_code: number;
  };
  raw_result: {
    status: 'pass' | 'partial' | 'unverified' | 'fail' | 'diagnostic_only' | 'unclassified';
    build: {
      version: string | null;
      tree_sha256: string | null;
    } | null;
  };
  execution_evidence: {
    child_exit: 'zero' | 'nonzero';
    wrapper_completion: 'unverified_from_guard_log';
    overall_acceptance: 'not_adjudicated';
  };
};

export type EvidenceInput = {
  runId: string;
  guardLogPath: string;
  resultPath: string;
};

export function buildEvidenceRecord(input: EvidenceInput): Promise<EvidenceRecord>;
export function writeEvidenceRecord(
  input: EvidenceInput & { outputPath: string },
): Promise<EvidenceRecord>;
