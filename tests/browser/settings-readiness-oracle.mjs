/**
 * Keep the native acceptance oracle aligned with SettingsView's About contract.
 * The UI reports local API availability; it does not claim the saved-login flow is ready.
 */
export function passwordApiReadinessMatches({ passwordApis, readiness, unavailableRemedy }) {
  return passwordApis
    ? readiness === 'Available'
    : readiness === 'Unavailable' && unavailableRemedy === true;
}
