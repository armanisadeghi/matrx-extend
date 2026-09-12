/**
 * byte-size-shape.mjs — THE SHAPE RULE for byte-size formatting.
 *
 * WHY A SHAPE RULE EXISTS AT ALL. `check:package-twins` is NAME-based: it fails
 * a local `function formatFileSize`. But the byte-size twins in this repo were
 * never called that. They were `formatBytes`, `fmtBytes`, `humanSize`,
 * `bytesToSize`, `formatSize`, `bytesHuman` — and two dozen more were not
 * functions at all, just `{(file.size / (1024 * 1024)).toFixed(2)} MB` inlined
 * into JSX. A name register cannot see any of that. The 2026-09-07 duplication
 * census named this gap in as many words ("the census method needs a shape
 * pass"); the 2026-09-11 re-verification proved it, finding 14+ live twins
 * under names nobody had registered.
 *
 * THE PATTERN THIS DETECTS. A byte count becoming a unit string, which in
 * JavaScript is always the same two things in one expression:
 *   (a) a DIVISION or COMPARISON against 1024 / 1048576 / 1073741824, and
 *   (b) a unit label literal — "B", "KB", "MB", "GB", "TB" (or the KiB/MiB
 *       binary spellings) — within the same short window.
 *
 * A capacity CONSTANT never matches: `80 * 1024 * 1024` multiplies, and the
 * detector requires `/ 1024`, `< 1024`, `>= 1024` etc. That asymmetry is the
 * whole reason the rule is usable — the repo has ~60 legitimate byte ceilings.
 *
 * THE SINGLE-UNIT FORM (added 2026-09-11 after an independent review). The
 * window above assumes the unit label sits near the arithmetic. One whole
 * idiom does not: the conversion is hoisted into a NAMED value at the top of a
 * component and the label is typed into JSX far below it. In
 * `features/flashcards/fast-fire/capture-test/WavePlayer.tsx` the division is
 * on line 58 and the ` KB` is on line 102 — forty-four lines away, invisible to
 * any window a byte-size rule could afford. What IS on line 58 is the unit: the
 * name. `const sizeKb = (blob.size / 1024).toFixed(0)` declares its unit in the
 * identifier, so an identifier ending in a byte unit (`…Kb`, `…KB`, `…MB`,
 * `…GiB`) taking a byte division is a formatter on its own evidence, with no
 * window at all.
 *
 * THE ONE HOME is `formatFileSize` from `@ai-matrx/kit/format`, which owns the
 * display decisions (binary units, one decimal below ten in a unit, whole bytes
 * below 1 KB, em-dash for unknown — never a confident "0 B").
 *
 * Exported as a module so `check-package-twins.mjs` can run it as its shape
 * lane and so the self-test can plant a body and prove it fails.
 */

/** Unit-label literal: " B", "KB", "MiB"… inside a string or template. */
const UNIT_LABEL_RE = /(?:^|[^A-Za-z])(?:[KMGT]i?B|B)(?:[^A-Za-z]|$)/;

/** A byte DIVISION or THRESHOLD COMPARISON. Multiplication never matches. */
const BYTE_DIVISOR_RE =
  /(?:\/\s*\(?\s*(?:1024|1048576|1073741824)|[<>]=?\s*\(?\s*(?:1024|1048576|1073741824))/;

/**
 * A value whose NAME carries the unit — `sizeKb`, `totalMB`, `ramGiB`. Paired
 * with a byte division on the same line this needs no window: the identifier
 * IS the unit label, which is exactly why the hoisted single-unit idiom slipped
 * past the windowed rule. Requires an assignment or property position so a
 * mere mention (`props.sizeKb`) is not a definition.
 */
const UNIT_NAMED_VALUE_RE =
  /\b[\w$]*(?:[KkMmGgTt]i?[Bb])\s*(?::[^=]*)?=(?!=)/;

/**
 * How many lines on EITHER side of a hit may supply the unit label. The window
 * is bidirectional because the two idioms put the label on opposite sides: the
 * cascade style writes it after (`return `${n/1024} KB``), while the loop style
 * declares `const units = ["B","KB",…]` ABOVE the `while (n >= 1024)`. A
 * forward-only window missed every loop-style twin — six of them, including
 * `bytesHuman`, `humanSize` and the field-formats registry.
 */
const WINDOW = 6;

/**
 * Byte-size formatting findings in one file's source.
 * Returns [{ line, text }] — every place a byte count becomes a unit string.
 */
export function byteShapeIn(source) {
  const lines = source.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!BYTE_DIVISOR_RE.test(line)) continue;
    // The single-unit form: the identifier carries the unit, so the label may
    // be anywhere — or nowhere at all, until it is typed into JSX far below.
    if (UNIT_NAMED_VALUE_RE.test(line)) {
      out.push({ line: i + 1, text: line.trim() });
      continue;
    }
    const window = lines
      .slice(Math.max(0, i - WINDOW), i + WINDOW + 1)
      .join("\n");
    if (!UNIT_LABEL_RE.test(window)) continue;
    out.push({ line: i + 1, text: line.trim() });
  }
  return out;
}

/** Proves the rule can fail and does not fire on a capacity constant. */
export function selfTestByteShape() {
  const planted = [
    "export function humanSize(bytes: number): string {",
    "  if (bytes < 1024) return `${bytes} B`;",
    "  return `${(bytes / 1024).toFixed(1)} KB`;",
    "}",
  ].join("\n");
  const found = byteShapeIn(planted);
  if (found.length === 0) {
    return { ok: false, why: "a planted byte-size body was NOT reported" };
  }
  const constants = [
    "const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;",
    "export const TUS_CHUNK_SIZE_BYTES = 16 * 1024 * 1024; // 16 MB chunks",
    "maxBuffer: 64 * 1024 * 1024,",
  ].join("\n");
  if (byteShapeIn(constants).length !== 0) {
    return { ok: false, why: "a capacity CONSTANT was reported as a formatter" };
  }
  const adopted = [
    'import { formatFileSize } from "@ai-matrx/kit/format";',
    "const label = formatFileSize(file.size);",
  ].join("\n");
  if (byteShapeIn(adopted).length !== 0) {
    return { ok: false, why: "an adopted call site was reported" };
  }
  // THE SINGLE-UNIT FORM: the unit is in the NAME and the label is forty-four
  // lines away in JSX. Nothing but the identifier can catch this.
  // Deliberately NO unit label anywhere in this fixture: in the real file it
  // was forty-four lines below, so a fixture that puts one nearby would be
  // caught by the windowed arm and would prove nothing about this one.
  const hoisted = ["  const sizeKb = (blob.size / 1024).toFixed(0);"].join("\n");
  if (byteShapeIn(hoisted).length === 0) {
    return {
      ok: false,
      why: "the hoisted single-unit form (`const sizeKb = blob.size / 1024`) was NOT reported",
    };
  }
  // …and a unit-named CONSTANT still escapes, because it multiplies.
  const namedCeiling = ["const maxUploadMb = 80 * 1024 * 1024;"].join("\n");
  if (byteShapeIn(namedCeiling).length !== 0) {
    return { ok: false, why: "a unit-named capacity CONSTANT was reported" };
  }
  return { ok: true };
}
