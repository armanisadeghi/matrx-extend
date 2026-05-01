import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAiExtraction } from '@/hooks/use-ai-extraction';
import { usePatternFromData } from '@/hooks/use-pattern-from-data';
import { type AgxAgent, fetchUserAgents } from '@/lib/supabase/queries';
import { useAuthStore } from '@/state/auth';
import { CheckCircle2, Loader2, Plus, Sparkles, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

type FieldType = 'string' | 'number' | 'date' | 'url' | 'boolean' | 'array';
const FIELD_TYPES: FieldType[] = ['string', 'number', 'date', 'url', 'boolean', 'array'];

// Built-in extractor agent ID — provisioned in the Matrx project as a public
// system agent. Used as the default unless the user has their own extractor.
const STRUCTURED_EXTRACTOR_AGENT_ID = 'c99595d6-7508-4f0d-b7d3-5218a3c69399';

// Built-in "Pattern from Extracted Data" agent — converts AI-extracted rows
// into a reusable list_pattern config so future runs need no AI.
const PATTERN_FROM_DATA_AGENT_ID = 'd5a6c513-d62f-4e09-b026-b869d8e3fcb1';

interface SchemaField {
  name: string;
  type: FieldType;
}

const buildJsonSchema = (fields: SchemaField[]): object => {
  if (fields.length === 0) return {};
  const properties: Record<string, unknown> = {};
  for (const f of fields) {
    if (!f.name) continue;
    if (f.type === 'array') {
      properties[f.name] = { type: 'array', items: { type: 'string' } };
    } else if (f.type === 'date') {
      properties[f.name] = { type: 'string', format: 'date' };
    } else if (f.type === 'url') {
      properties[f.name] = { type: 'string', format: 'uri' };
    } else {
      properties[f.name] = { type: f.type };
    }
  }
  return { type: 'object', properties };
};

export function AiExtractTab() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [agents, setAgents] = useState<AgxAgent[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<SchemaField[]>([]);
  const { rows, running, error, notes, confidence, extract, cancel } = useAiExtraction();
  const {
    result: patternResult,
    running: patternRunning,
    error: patternError,
    convert: convertToPattern,
    reset: resetPattern,
  } = usePatternFromData();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const list = await fetchUserAgents(userId);
      if (cancelled) return;
      setAgents(list);
      const preferred =
        list.find((a) => a.id === STRUCTURED_EXTRACTOR_AGENT_ID) ??
        list.find((a) => a.name?.toLowerCase().includes('structured extractor')) ??
        list.find((a) => a.name?.toLowerCase().includes('extract')) ??
        list[0];
      if (preferred) setAgentId(preferred.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const outputSchema = useMemo(() => buildJsonSchema(fields), [fields]);

  const addField = () => setFields((f) => [...f, { name: '', type: 'string' }]);
  const removeField = (i: number) => setFields((f) => f.filter((_, idx) => idx !== i));
  const updateField = (i: number, patch: Partial<SchemaField>) =>
    setFields((f) => f.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const handleRun = () => {
    if (!agentId || !description.trim()) return;
    void extract({ agentId, description, outputSchema });
  };

  const canRun = agentId && description.trim().length > 0 && !running;

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            AI Extract
          </div>
          <div className="text-xs text-muted-foreground">
            Describe what you want; the extractor agent reads the page and returns rows that
            match your schema. Best for hostile UIs and ad-hoc shapes.
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">Agent</div>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="h-8 w-full rounded-full bg-secondary/40 px-3 text-xs outline-none focus-visible:ring-1"
          >
            {agents.length === 0 && <option value="">No agents available</option>}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.category ? ` · ${a.category}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">What to extract</div>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. every concert listing on this page — name, date, venue, price, ticket URL"
            className="min-h-[80px] rounded-xl bg-secondary/40 text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium text-muted-foreground">
              Output schema (optional)
            </div>
            <Button size="sm" variant="ghost" onClick={addField} className="h-6 gap-1 px-2 text-[10px]">
              <Plus className="size-3" /> Field
            </Button>
          </div>
          {fields.length === 0 ? (
            <div className="rounded-xl bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
              Leave empty to let the agent infer the schema from your description.
            </div>
          ) : (
            <div className="space-y-1">
              {fields.map((f, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: schema rows reorder by user.
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    value={f.name}
                    onChange={(e) => updateField(i, { name: e.target.value })}
                    placeholder="field_name"
                    className="h-7 flex-1 rounded-full bg-secondary/40 text-[11px]"
                  />
                  <select
                    value={f.type}
                    onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                    className="h-7 rounded-full bg-secondary/40 px-2 text-[11px] outline-none focus-visible:ring-1"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeField(i)}
                    className="size-7 shrink-0"
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleRun}
            disabled={!canRun}
            className="flex-1 rounded-full"
          >
            {running ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {running ? 'Extracting…' : 'Extract'}
          </Button>
          {running && (
            <Button variant="secondary" onClick={() => void cancel()} className="rounded-full">
              Cancel
            </Button>
          )}
        </div>

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {(notes || confidence) && (
          <div className="space-y-1 rounded-xl bg-secondary/40 px-3 py-2 text-xs">
            {confidence && (
              <div>
                <span className="text-muted-foreground">Confidence:</span>{' '}
                <span className="font-medium">{confidence}</span>
              </div>
            )}
            {notes && <div className="text-muted-foreground">{notes}</div>}
          </div>
        )}

        {rows && <ResultPreview rows={rows} />}

        {rows && rows.length > 0 && (
          <div className="space-y-2">
            <div className="rounded-xl bg-violet-500/5 p-3 ring-1 ring-violet-500/30">
              <div className="text-[11px] font-medium uppercase tracking-wider text-violet-700 dark:text-violet-400">
                Convert to reusable pattern
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Hand the extracted rows + sample HTML to the Pattern-from-Data agent. It returns
                CSS selectors that re-create these rows with no AI on future runs.
              </div>
              {patternResult ? (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    Pattern generated
                    {patternResult.confidence && (
                      <span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider">
                        {patternResult.confidence}
                      </span>
                    )}
                  </div>
                  <div className="space-y-0.5 rounded-lg bg-background/60 p-2 font-mono text-[10px]">
                    <div>
                      <span className="text-muted-foreground">root: </span>
                      <span className="break-all">{patternResult.config.list_root}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">item: </span>
                      <span className="break-all">{patternResult.config.item_selector}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {patternResult.config.field_paths.length} field(s):{' '}
                      {patternResult.config.field_paths.map((f) => f.name).join(', ')}
                    </div>
                  </div>
                  {patternResult.notes && (
                    <div className="rounded-lg bg-secondary/40 p-2 text-[11px] text-muted-foreground">
                      {patternResult.notes}
                    </div>
                  )}
                  {patternResult.warnings && patternResult.warnings.length > 0 && (
                    <ul className="rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                      {patternResult.warnings.map((w, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: render-only.
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={resetPattern} className="rounded-full">
                      Discard
                    </Button>
                    <SaveAsPattern
                      kind="list_pattern"
                      config={patternResult.config}
                      rows={rows}
                      defaultName={
                        description.slice(0, 40) || `Auto-pattern · ${rows.length} items`
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void convertToPattern({
                        agentId: PATTERN_FROM_DATA_AGENT_ID,
                        userInput: description,
                        extractedRows: rows,
                      })
                    }
                    disabled={patternRunning}
                    className="rounded-full"
                  >
                    {patternRunning ? <Loader2 className="animate-spin" /> : <Wand2 />}
                    {patternRunning ? 'Generating pattern…' : 'Convert to reusable pattern'}
                  </Button>
                  {patternError && (
                    <span className="text-[11px] text-destructive">{patternError}</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <SaveAsPattern
                kind="ai_extract"
                config={{ description, output_schema: outputSchema, agent_id: agentId }}
                rows={rows}
                defaultName={description.slice(0, 40) || 'AI extraction'}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
