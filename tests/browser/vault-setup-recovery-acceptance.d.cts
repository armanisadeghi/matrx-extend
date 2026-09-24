// Type surface of vault-setup-recovery-acceptance.cjs for the unit tests that
// import it. The runtime file is plain CommonJS; without this declaration
// `tsc --noEmit` (and therefore prebuild/prezip) fails with TS7016.
export declare const vaultRefreshControl: string;
export declare const vaultSetupRecoveryFixturePath: string;
export declare function renderVaultSetupRecoveryFixtureHTML(...args: unknown[]): string;
export declare function allMatchingVaultListReadsRefused(...args: unknown[]): boolean;
export declare function runVaultListTransportRecoveryChecks(args: Record<string, unknown>): Promise<unknown>;
export declare function runVaultSetupRecoveryChecks(args: Record<string, unknown>): Promise<unknown>;
