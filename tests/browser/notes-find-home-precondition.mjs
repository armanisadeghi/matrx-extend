const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only bounded counts and booleans leave this precondition; tree rows remain private. */
export function inspectNotesFindHomePrecondition(tree, organizationId) {
  const scopes = tree.scopes.filter((scope) => scope.organization_id === organizationId);
  const types = tree.types.filter((type) => type.organization_id === organizationId);
  const general = scopes.filter((scope) => scope.name?.toLocaleLowerCase() === 'general');
  const typeId = general.length === 1 ? general[0].scope_type_id : null;
  const typeIdValid = UUID.test(typeId ?? '');
  const typePresent = typeIdValid && types.some((type) => type.id === typeId);
  const code =
    general.length === 0
      ? 'notes_find_general_home_missing'
      : general.length > 1
        ? 'notes_find_general_home_duplicate'
        : !typeIdValid
          ? 'notes_find_general_home_type_id_invalid'
          : !typePresent
            ? 'notes_find_general_home_type_unavailable'
            : null;
  return {
    code,
    general: code === null ? general[0] : null,
    typeId: code === null ? typeId : null,
    diagnostic: {
      selected_org_scope_count: scopes.length,
      selected_org_type_count: types.length,
      literal_general_count: general.length,
      general_type_id_valid: typeIdValid,
      general_type_in_tree: typePresent,
    },
  };
}
