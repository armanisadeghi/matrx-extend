import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as ours from './save-source-logic';

// The web app's Save panel logic is the reference; both must decide the same.
const WEB = '/Users/armanisadeghi/code/matrx-frontend/features/sources/saveSourceLogic.ts';
const WEB_PATH = process.env.MATRX_FRONTEND_DIR
  ? `${process.env.MATRX_FRONTEND_DIR}/features/sources/saveSourceLogic.ts`
  : WEB;

const staged = [
  { token: 'project', id: 'p1', label: 'AI Advancements' },
  { token: 'scope', id: 's1', label: ' ' },
  { token: 'project', id: 'p1', label: 'AI Advancements' },
];

describe('save-source-logic', () => {
  it('builds attach_to with the Library edge labelled catalogued_source, deduped', () => {
    expect(ours.buildAttachTargets(staged, 'lib-1')).toEqual([
      { entity_type: 'project', entity_id: 'p1' },
      { entity_type: 'scope', entity_id: 's1' },
      { entity_type: 'media_source_library', entity_id: 'lib-1', label: 'catalogued_source' },
    ]);
  });

  it('names every place filed', () => {
    expect(ours.filedPlacesWords(staged.slice(0, 1), null)).toBe('filed in AI Advancements');
    expect(ours.filedPlacesWords(staged.slice(0, 2), 'Web clips')).toBe(
      'filed in AI Advancements, scope and the Library Web clips',
    );
    expect(ours.filedPlacesWords([], null)).toBe('');
  });

  it.skipIf(!existsSync(WEB_PATH))(`decides exactly like the web app (${WEB_PATH})`, () => {
    // The web file is pure (no imports), so it is transpiled and evaluated as-is.
    const code = ts.transpileModule(readFileSync(WEB_PATH, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} as Record<string, unknown> };
    new Function('module', 'exports', code)(module, module.exports);
    const web = module.exports as unknown as typeof ours;
    expect([...ours.SAVE_TARGET_TOKENS]).toEqual([...web.SAVE_TARGET_TOKENS]);
    expect(ours.LIBRARY_TOKEN).toBe(web.LIBRARY_TOKEN);
    for (const lib of [null, 'lib-1']) {
      expect(ours.buildAttachTargets(staged, lib)).toEqual(web.buildAttachTargets(staged, lib));
      expect(ours.filedPlacesWords(staged, lib)).toBe(web.filedPlacesWords(staged, lib));
    }
    for (const i of ['queued', 'deferred', 'never'] as const) {
      for (const k of [true, false]) {
        expect(ours.intelligenceSentence(i, k)).toBe(web.intelligenceSentence(i, k));
      }
    }
    expect(ours.rememberedLibraryKey('u')).toBe(web.rememberedLibraryKey('u'));
  });
});
