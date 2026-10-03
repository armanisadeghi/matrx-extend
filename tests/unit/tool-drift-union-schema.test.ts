// @vitest-environment node
// Use case: a handler whose args are a discriminated union (record_demo) is
// compared against its flat tool.definition row without false drift.
import { describe, expect, it } from 'vitest';
import { flattenLocalSchema } from '../../scripts/check-tool-db-drift';
import catalog from '../../types/tool-catalog.json';

type CatalogTool = { name: string; input_schema: Parameters<typeof flattenLocalSchema>[0] };

describe('drift check reads a union-shaped local schema as one flat contract', () => {
  it('record_demo flattens to every branch field, action required, actions as one enum', () => {
    const tools = ((catalog as { tools?: CatalogTool[] }).tools ?? catalog) as CatalogTool[];
    const recordDemo = tools.find((t) => t.name === 'record_demo');
    expect(recordDemo?.input_schema).toHaveProperty('anyOf');

    const flat = flattenLocalSchema(recordDemo?.input_schema);
    expect(Object.keys(flat.properties).sort()).toEqual(
      ['action', 'description', 'name', 'parameters', 'tab_id'].sort(),
    );
    expect(flat.required).toEqual(['action']);
    expect(flat.properties.action?.enum?.slice().sort()).toEqual([
      'discard',
      'start',
      'status',
      'stop',
    ]);
    expect(flat.properties.action).not.toHaveProperty('const');
  });

  it('a plain object schema passes through unchanged', () => {
    const schema = {
      type: 'object' as const,
      properties: { url: { type: 'string' } },
      required: ['url'],
    };
    expect(flattenLocalSchema(schema)).toEqual({
      properties: schema.properties,
      required: ['url'],
    });
  });
});
