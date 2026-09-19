import type {
  GeneratedPasswordConstraint,
  GeneratedPasswordFillStatus,
} from './fill-primitive';

export const GENERATION_INVALIDATED = 'invalidated' as const;

export interface GenerationInvalidationMessage {
  __matrxCredentialGeneration: true;
  operation: typeof GENERATION_INVALIDATED;
  offerIds: string[];
}

export type GenerationRequest =
  | { __matrxCredentialGeneration: true; operation: 'discover'; tabId: number }
  | { __matrxCredentialGeneration: true; operation: 'use'; offerId: string; value: string }
  | { __matrxCredentialGeneration: true; operation: 'discard'; offerIds: string[] };

export interface GenerationOffer {
  id: string;
  origin: string;
  frameId: number;
  fieldCount: number;
  constraints: GeneratedPasswordConstraint[];
  expiresAt: number;
}

export type GenerationDiscoveryResponse =
  | { status: 'ready'; offers: GenerationOffer[] }
  | {
      status: 'no_targets' | 'stale' | 'unavailable' | 'unsafe_destination';
      message: string;
    };

export interface GenerationUseResponse {
  status: GeneratedPasswordFillStatus | 'stale' | 'unavailable';
  message: string;
}
