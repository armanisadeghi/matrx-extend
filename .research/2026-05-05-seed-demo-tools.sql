-- 2026-05-05 — Seed demo-system tools (matrx-extend v0.1.6).
--
-- Adds the 5 handlers that ship in src/lib/tools/handlers/demos.ts:
--   matrx-extend:record_demo   — start/stop/discard/status of a recording
--   matrx-extend:list_demos    — list all saved demos
--   matrx-extend:describe_demo — full step list for one demo
--   matrx-extend:replay_demo   — execute a saved demo (privileged — always confirms)
--   matrx-extend:delete_demo   — remove a saved demo
--
-- Surface assignments:
--   chrome-extension/pilot      — all 5
--   chrome-extension/assistant  — list_demos, describe_demo (read-tier only)
--
-- Idempotent: re-running this is a no-op once the rows exist.
-- Run AFTER the main convergence script.

BEGIN;

INSERT INTO public.tl_def
  (name, description, parameters, category, tier, tool_group, dedupe_exempt, admin_only, privileged, source_app, function_path)
VALUES
  ('matrx-extend:record_demo',
   'Record a user demonstration that can later be replayed by the agent. Actions: ''start'' (begin recording on a tab; clicks, typed text, submits, navigations, and scrolls are captured automatically as the user demonstrates), ''stop'' (save the recording with a name + parameter declarations; sensitive fields like passwords are auto-parameterised), ''discard'' (throw away the in-flight recording without saving), ''status'' (read; report whether a recording is active and how many steps have been captured). Coach the user: ask them to walk through the workflow, then call stop when they say they''re done. Saved demos are replayed via replay_demo.',
   '{
      "action": {"type": "string", "enum": ["start", "stop", "discard", "status"], "description": "Lifecycle phase.", "required": true},
      "tab_id": {"type": "integer", "description": "For action=start. Defaults to active tab when omitted."},
      "name": {"type": "string", "minLength": 1, "maxLength": 100, "description": "For action=stop. Human-readable demo name."},
      "description": {"type": "string", "maxLength": 500, "description": "For action=stop. Optional longer description."},
      "parameters": {
        "type": "array",
        "description": "For action=stop. Declared parameter slots; steps with param_placeholder set must reference one of these.",
        "items": {
          "type": "object",
          "properties": {
            "name": {"type": "string", "minLength": 1},
            "description": {"type": "string"},
            "type": {"type": "string"},
            "sensitive": {"type": "boolean"}
          }
        }
      }
    }'::jsonb,
   'demos', 'action', 'demos', false, false, false, 'matrx-extend', ''),

  ('matrx-extend:list_demos',
   'List every saved demo as { id, name, description, start_url, step_count, parameter_names, created_at, updated_at }. Use to find a demo to replay or describe.',
   '{}'::jsonb,
   'demos', 'read', 'demos', true, false, false, 'matrx-extend', ''),

  ('matrx-extend:describe_demo',
   'Return the full step list for a saved demo. Each step has { kind, url, selector_chain, element_snapshot, input_text, param_placeholder, is_sensitive }. Use before replay to verify what the demo will do. input_text is blanked for sensitive steps.',
   '{
      "demo_id": {"type": "string", "minLength": 1, "description": "Demo id from list_demos.", "required": true}
    }'::jsonb,
   'demos', 'read', 'demos', true, false, false, 'matrx-extend', ''),

  ('matrx-extend:replay_demo',
   'Replay a saved demo against a tab. Always requires confirmation — the demo can click, type, submit, and navigate (which can trigger purchases, sends, deletes). Pass dry_run:true to test selector resolution without taking action. Pass params to substitute placeholders (sensitive fields like passwords MUST be supplied this way; the agent should ask the user via ask_user(type=secret) first). Returns per-step results with resolved_via showing which selector strategy hit.',
   '{
      "demo_id": {"type": "string", "minLength": 1, "description": "Demo id from list_demos.", "required": true},
      "tab_id": {"type": "integer", "description": "Override target tab. Defaults to active."},
      "params": {
        "type": "object",
        "description": "Substitution map for parameterised steps (param_name → string value). Sensitive params MUST be supplied here, never recorded.",
        "additionalProperties": {"type": "string"}
      },
      "dry_run": {"type": "boolean", "description": "When true, resolve selectors but skip side-effecting actions. Use to verify a demo still works after a site redesign."}
    }'::jsonb,
   'demos', 'privileged', 'demos', false, false, true, 'matrx-extend', ''),

  ('matrx-extend:delete_demo',
   'Delete a saved demo by id. Cannot be undone.',
   '{
      "demo_id": {"type": "string", "minLength": 1, "description": "Demo id from list_demos.", "required": true}
    }'::jsonb,
   'demos', 'action', 'demos', false, false, false, 'matrx-extend', '')
ON CONFLICT (name) DO NOTHING;

-- Surface assignments. Pilot gets all 5; assistant gets the 2 read-tier ones.
INSERT INTO public.tl_def_surface (tool_id, surface_name)
SELECT t.id, 'chrome-extension/pilot'
FROM public.tl_def t
WHERE t.name IN (
  'matrx-extend:record_demo',
  'matrx-extend:list_demos',
  'matrx-extend:describe_demo',
  'matrx-extend:replay_demo',
  'matrx-extend:delete_demo'
)
ON CONFLICT (tool_id, surface_name) DO NOTHING;

INSERT INTO public.tl_def_surface (tool_id, surface_name)
SELECT t.id, 'chrome-extension/assistant'
FROM public.tl_def t
WHERE t.name IN (
  'matrx-extend:list_demos',
  'matrx-extend:describe_demo'
)
ON CONFLICT (tool_id, surface_name) DO NOTHING;

COMMIT;

-- Sanity check.
SELECT name, category, tier, dedupe_exempt, privileged
FROM public.tl_def
WHERE name LIKE 'matrx-extend:%demo%'
ORDER BY name;
