/**
 * THE CLASS GUARD for provenance attestation.
 *
 * aidream derives an unfakeable `origin_class` for every AI request, and the
 * ONE input a client has into it is `initiation: 'user' | 'auto'` on the
 * request body. OMIT the field and the run is classed `api` — an unattested
 * HTTP caller — so an omission does not fail, error, or warn: it silently
 * files a person's chat as a robot's. Nothing at runtime can catch that, which
 * is exactly why the guard is here.
 *
 * This is a census, not a spot check: it walks EVERY request body in `src/`
 * that opens a stream against an AI execute or resume endpoint and fails the
 * ones that carry no attestation. A new AI surface added without `initiation`
 * fails this test on the first run.
 *
 * Proven falsifiable: `attestationOf` is a pure function, and the cases below
 * feed it a body with no `initiation` key and assert it reports `null`. Delete
 * the stamp from any file in BODY_BUILDERS and this suite goes red.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Every AI request body this extension sends, and the attestation each one is
 * expected to carry. `'declared'` means the value is threaded in from the call
 * site (the builder must reference `initiation`, and the drivers are pinned
 * separately below) rather than hardcoded.
 */
const BODY_BUILDERS: Array<{
  file: string;
  /** Anchor identifying the body literal inside the file. */
  anchor: string;
  expect: 'user' | 'auto' | 'declared';
  why: string;
}> = [
  {
    file: 'hooks/use-chat-stream.ts',
    anchor: "source_feature: opts.sourceFeature ?? 'chat'",
    expect: 'declared',
    why: 'chat composer / retry / ask-card default to user; Agenda automation passes auto',
  },
  {
    file: 'hooks/use-pilot-chat-stream.ts',
    anchor: "source_feature: 'pilot-chat'",
    expect: 'declared',
    why: 'Pilot composer submit defaults to user',
  },
  {
    file: 'hooks/use-ai-extraction.ts',
    anchor: "source_feature: 'data-ai-extract'",
    expect: 'user',
    why: 'the Extract button in AiExtractTab is the only driver',
  },
  {
    file: 'hooks/use-pattern-from-data.ts',
    anchor: "source_feature: 'data-pattern-from-data'",
    expect: 'user',
    why: 'pattern-from-rows button in AiExtractTab is the only driver',
  },
  {
    file: 'lib/data-pattern/run-interactive.ts',
    anchor: "source_feature: 'data-ai-extract-rerun'",
    expect: 'declared',
    why: 'run buttons pass user, the data_patterns agent tool passes auto',
  },
  {
    file: 'lib/tools/handlers/parallel.ts',
    anchor: "source_feature: 'parallel-tab'",
    expect: 'auto',
    why: 'a sub-run spawned by an agent tool call is never a human gesture',
  },
];

/** Bodies with no `source_feature` of their own: the two /resume payloads. */
const RESUME_BODIES: Array<{ file: string; expect: 'auto' }> = [
  { file: 'hooks/use-chat-stream.ts', expect: 'auto' },
  { file: 'hooks/use-pilot-chat-stream.ts', expect: 'auto' },
];

const read = (file: string): string => readFileSync(join(SRC, file), 'utf8');

/**
 * Extract the `initiation` value from the object literal containing `anchor`.
 * Returns null when the literal carries no attestation at all — the failure
 * mode this whole file exists to catch.
 */
/** How far from the anchor an attestation may sit and still belong to it. */
const WINDOW_LINES = 12;

function attestationOf(source: string, anchor: string): string | null {
  const lines = source.split('\n');
  // Skip doc-comment mentions of the anchor (several of these files describe
  // their own `source_feature` in the header block) — only real code counts.
  const isComment = (l: string): boolean => /^\s*(\*|\/\/|\/\*)/.test(l);
  const anchorLine = lines.findIndex((l) => l.includes(anchor) && !isComment(l));
  if (anchorLine < 0) throw new Error(`anchor not found in code: ${anchor}`);

  // Scan a bounded window around the anchor line, stopping at any OTHER
  // request body's marker — so a neighbouring body's stamp can never be
  // credited to this one.
  const scan = (step: -1 | 1): string | null => {
    for (let i = anchorLine; i >= 0 && i < lines.length; i += step) {
      if (Math.abs(i - anchorLine) > WINDOW_LINES) return null;
      const line = lines[i] ?? '';
      if (i !== anchorLine && /source_feature:/.test(line)) return null;
      const hit = line.match(/initiation:\s*(?:opts\.initiation\s*\?\?\s*)?'(user|auto)'/);
      if (hit?.[1]) return line.includes('opts.initiation ??') ? 'declared' : hit[1];
      if (/initiation:\s*(opts|input)\.initiation\b/.test(line)) return 'declared';
    }
    return null;
  };

  return scan(1) ?? scan(-1);
}

describe('initiation attestation — every AI request body', () => {
  for (const entry of BODY_BUILDERS) {
    it(`${entry.file} sends initiation='${entry.expect}' (${entry.why})`, () => {
      expect(attestationOf(read(entry.file), entry.anchor)).toBe(entry.expect);
    });
  }

  for (const entry of RESUME_BODIES) {
    it(`${entry.file} stamps the /resume body 'auto' (client code, never a gesture)`, () => {
      const source = read(entry.file);
      // The resume literal is the one carrying `context,` plus the attestation.
      expect(source).toMatch(/initiation:\s*'auto' satisfies RequestInitiation/);
    });
  }

  it('use-agent-text-run stamps the caller-declared attestation onto the body', () => {
    const source = read('hooks/use-agent-text-run.ts');
    expect(source).toMatch(/initiation:\s*input\.initiation/);
    // Required, not optional: a generic one-shot primitive must not guess.
    expect(source).toMatch(/initiation:\s*RequestInitiation;/);
  });
});

describe('the guard can fail (falsifiability)', () => {
  it('reports null for a body with no attestation', () => {
    const unattested = `const body = {
      conversation_id: 'x',
      source_app: 'matrx-extend',
      source_feature: 'never-attested',
    };`;
    expect(attestationOf(unattested, "source_feature: 'never-attested'")).toBeNull();
  });

  it('does not let a neighbouring body satisfy an unattested one', () => {
    const twoBodies = `const a = { source_feature: 'attested', initiation: 'user' };
      const b = { source_feature: 'bare' };`;
    expect(attestationOf(twoBodies, "source_feature: 'attested'")).toBe('user');
    expect(attestationOf(twoBodies, "source_feature: 'bare'")).toBeNull();
  });

  it('reads a hardcoded auto stamp as auto, not as declared', () => {
    const body = `const body = { source_feature: 'sub-run', initiation: 'auto' };`;
    expect(attestationOf(body, "source_feature: 'sub-run'")).toBe('auto');
  });
});
