const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only bounded counts and booleans leave this precondition; tree/home rows remain private. */
export function inspectNotesFindHomePrecondition(tree, organizationId, homes) {
  const scopes = tree.scopes.filter((scope) => scope.organization_id === organizationId);
  const types = tree.types.filter((type) => type.organization_id === organizationId);
  // my_homes supplies canonical identity even before lazy initialization or after a rename.
  const canonical = homes.filter(
    (home) => home.organization_id === organizationId && home.is_general === true,
  );
  const homeId = canonical.length === 1 ? canonical[0].scope_id : undefined;
  const uninitialized = canonical.length === 1 && homeId === null;
  const homeIdValid = UUID.test(homeId ?? '');
  const general = homeIdValid ? scopes.filter((scope) => scope.id === homeId) : [];
  const typeId = general.length === 1 ? general[0].scope_type_id : null;
  const typeIdValid = UUID.test(typeId ?? '');
  const typePresent = typeIdValid && types.some((type) => type.id === typeId);
  const code =
    canonical.length === 0
      ? 'notes_find_general_home_missing'
      : canonical.length > 1
        ? 'notes_find_general_home_duplicate'
        : uninitialized
          ? 'notes_find_general_home_uninitialized'
          : !homeIdValid
            ? 'notes_find_general_home_id_invalid'
            : general.length !== 1
              ? 'notes_find_general_home_tree_unavailable'
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
      literal_general_count: scopes.filter((scope) => scope.name?.toLocaleLowerCase() === 'general')
        .length,
      canonical_general_count: canonical.length,
      canonical_general_uninitialized: uninitialized,
      canonical_general_id_valid: homeIdValid,
      canonical_general_in_tree: general.length === 1,
      general_type_id_valid: typeIdValid,
      general_type_in_tree: typePresent,
    },
  };
}
