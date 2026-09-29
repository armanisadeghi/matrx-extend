import { type ActiveTabInfo, refreshActiveTabIdentity } from '@/hooks/use-active-tab';

/** Shared remedy while Chrome cannot prove the active top-frame document. */
export function PageIdentityNotice({
  tab,
}: { tab: Pick<ActiveTabInfo, 'pageKey' | 'identityError'> }) {
  if (tab.pageKey) return null;
  return (
    <output className="mx-3 my-2 rounded-xl bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
      {tab.identityError ?? 'Checking the current page…'}{' '}
      <button
        type="button"
        className="font-medium text-primary underline"
        onClick={() => void refreshActiveTabIdentity()}
      >
        Retry
      </button>
    </output>
  );
}
