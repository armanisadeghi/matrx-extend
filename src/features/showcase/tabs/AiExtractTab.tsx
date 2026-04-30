import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAiExtraction } from '@/hooks/use-ai-extraction';
import { type AgxAgent, fetchUserAgents } from '@/lib/supabase/queries';
import { useAuthStore } from '@/state/auth';
import { Loader2, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

type FieldType = 'string' | 'number' | 'date' | 'url' | 'boolean' | 'array';
const FIELD_TYPES: FieldType[] = ['string', 'number', 'date', 'url', 'boolean', 'array'];

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

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const list = await fetchUserAgents(userId);
      if (cancelled) return;
      setAgents(list);
      const preferred =
        list.find((a) => a.name?.toLowerCase().includes('extract')) ?? list[0];
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
          <div className="flex justify-end">
            <SaveAsPattern
              kind="ai_extract"
              config={{ description, output_schema: outputSchema, agent_id: agentId }}
              rows={rows}
              defaultName={description.slice(0, 40) || 'AI extraction'}
            />
          </div>
        )}
      </div>
    </div>
  );
}
