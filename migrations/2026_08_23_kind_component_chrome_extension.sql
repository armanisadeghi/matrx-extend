-- Register the Chrome extension as a Content IR RENDER PLATFORM.
--
-- Why: `content_ir.kind_component` read web 628 · vite 14 · chrome-extension 0
-- · desktop 0, while Arman's standing requirement is "our mobile app, desktop
-- app, UI, everybody will render it using the same set of data"
-- (KINDS_EVERYWHERE_PLAN §10g GAP 5). The extension received server-built
-- `render_block` envelopes and DISCARDED them because nothing told it which
-- component draws a kind here.
--
-- The `platform` vocabulary already contained 'chrome-extension' (the table's
-- CHECK constraint) — no schema change is needed, only the missing data.
--
-- Component keys are NOT the web app's keys, deliberately: a `web` row names a
-- Next.js component this repo does not have, and `kind_component.platform`
-- exists precisely so a 400px side panel and a 1200px page can draw the same
-- kind differently. The extension's dispatch table
-- (`src/components/kinds/dispatch.tsx`) maps each key below to a real
-- component; a kind with no row here falls to the honest generic floor.
--
-- Idempotent: re-running updates the same (kind_definition_id, platform, role,
-- component_key) rows rather than duplicating them.

do $$
declare
  v_org uuid := '39c38960-d30c-4840-b0c1-c9960de95582';  -- Matrx System (globally readable)
  v_pair record;
begin
  for v_pair in
    select * from (values
      ('markdown',              'markdown_panel'),
      ('web_search_results',    'search_results_panel'),
      ('google_search_results', 'search_results_panel'),
      ('news_search_results',   'search_results_panel'),
      ('flashcard_set',         'flashcard_set_panel'),
      ('quiz_set',              'quiz_set_panel')
    ) as t(kind, component_key)
  loop
    -- A kind that does not exist is a REAL problem (a renamed slug), not
    -- something to paper over: say so loudly and keep going.
    if not exists (
      select 1 from content_ir.kind_definition
      where kind = v_pair.kind and deleted_at is null
    ) then
      raise warning 'kind_component(chrome-extension): kind "%" is not registered — row skipped', v_pair.kind;
      continue;
    end if;

    insert into content_ir.kind_component (
      kind_definition_id, platform, role, component_key, source,
      config, is_default, is_active, sort_order, organization_id
    )
    select kd.id, 'chrome-extension', 'output', v_pair.component_key, 'bundled',
           '{}'::jsonb, true, true, 100, v_org
    from content_ir.kind_definition kd
    where kd.kind = v_pair.kind and kd.deleted_at is null
      and not exists (
        select 1 from content_ir.kind_component kc
        where kc.kind_definition_id = kd.id
          and kc.platform = 'chrome-extension'
          and kc.role = 'output'
          and kc.component_key = v_pair.component_key
      );

    update content_ir.kind_component kc
       set is_active = true, deleted_at = null
      from content_ir.kind_definition kd
     where kc.kind_definition_id = kd.id
       and kd.kind = v_pair.kind
       and kc.platform = 'chrome-extension'
       and kc.role = 'output'
       and kc.component_key = v_pair.component_key
       and (kc.is_active is distinct from true or kc.deleted_at is not null);
  end loop;
end $$;
