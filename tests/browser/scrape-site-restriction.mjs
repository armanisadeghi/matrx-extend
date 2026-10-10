// Native Chrome user-site settings, scoped to the owned fixture origin only.
// Never rewrite the whole list or remove a pre-existing restriction.
export async function readSiteRestriction(details, origin) {
  return details.evaluate(async (ownedOrigin) => {
    const api = chrome.developerPrivate;
    if (!api?.getUserSiteSettings || !api?.addUserSpecifiedSites || !api?.removeUserSpecifiedSites)
      throw new Error('scrape_recovery_site_settings_api_missing');
    const settings = await api.getUserSiteSettings();
    if (!Array.isArray(settings.restrictedSites) || !Array.isArray(settings.permittedSites))
      throw new Error('scrape_recovery_site_settings_invalid');
    return {
      restricted: settings.restrictedSites.includes(ownedOrigin),
      permitted: settings.permittedSites.includes(ownedOrigin),
    };
  }, origin);
}

export async function setSiteRestriction(
  details,
  origin,
  restricted,
  expectedBefore,
  onMutationAttempt = () => {},
) {
  const before = await readSiteRestriction(details, origin);
  if (before.permitted || (expectedBefore !== null && before.restricted !== expectedBefore))
    throw new Error('scrape_recovery_site_restriction_precondition_failed');
  if (before.restricted !== restricted) {
    onMutationAttempt();
    await details.evaluate(
      async ({ ownedOrigin, deny }) => {
        const api = chrome.developerPrivate;
        const options = { siteSet: 'USER_RESTRICTED', hosts: [ownedOrigin] };
        if (deny) await api.addUserSpecifiedSites(options);
        else await api.removeUserSpecifiedSites(options);
      },
      { ownedOrigin: origin, deny: restricted },
    );
  }
  const after = await readSiteRestriction(details, origin);
  if (after.restricted !== restricted || after.permitted)
    throw new Error('scrape_recovery_site_restriction_not_observed');
  return after;
}
