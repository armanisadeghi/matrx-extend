import { click, toolsCatalogState, waitFor } from './settings-panel-driver.mjs';

/** Shared native, read-only organization proof door; never synthesize its HTTP request. */
export async function openOrganizationRecords(
  panel,
  {
    clickControl = click,
    resourceAction = (action) => action(),
    onStage = () => {},
    onCatalog = () => {},
    beforeRecords = () => {},
  } = {},
) {
  onStage('organization_tools_gate');
  await resourceAction(async () => {
    onStage('organization_tools_click');
    await clickControl(panel, 'title', 'Tools');
  });
  onStage('organization_records_gate');
  await resourceAction(async () => {
    await waitFor(
      'showcase_tools_catalog_ready',
      async () => {
        const state = await toolsCatalogState(panel);
        onCatalog(state);
        return state;
      },
      (state) => state === 'catalog',
    );
    onStage('organization_records_click');
    beforeRecords();
    await clickControl(panel, 'tool-row', 'records');
  });
}
