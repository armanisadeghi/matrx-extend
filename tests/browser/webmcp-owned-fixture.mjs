// Harbor Dental's intake desk checks a newly received form. The counter is a
// visible, deterministic side effect; no customer data enters this page.
export function webmcpOwnedFixture(runId) {
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('webmcp_fixture_run_id_refused');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Harbor Dental intake desk</title>
<h1>Harbor Dental intake desk</h1><output id="intake-count">0</output>
<script>
(() => {
  const runId = ${JSON.stringify(runId)};
  const name = 'harbor_dental_intake_count_' + runId.replaceAll('-', '_');
  const state = {name, count:0, apiPresent: Boolean(document.modelContext), registered:false};
  window.__webmcpOwned = state;
  state.ready = (async () => {
    const api = document.modelContext;
    if (typeof api?.registerTool !== 'function') return false;
    await api.registerTool({
      name,
      description:'Count a received new-patient intake form',
      inputSchema:{type:'object',properties:{nonce:{type:'string'}},required:['nonce']},
      execute:async ({nonce}) => {
        if (typeof nonce !== 'string') throw new Error('nonce required');
        state.count += 1;
        document.getElementById('intake-count').textContent=String(state.count);
        return {nonce,count:state.count,marker:'harbor-dental-intake-' + runId};
      },
    });
    state.registered=true;
    return true;
  })();
})();
</script></html>`;
}
