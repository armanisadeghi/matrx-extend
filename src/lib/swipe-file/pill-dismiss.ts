/**
 * The swipe-file card's close button. Closing it hides the card on every page
 * until the person opens the extension again (popup or side panel), which
 * clears the flag.
 */
export const SWIPE_PILL_HIDDEN_KEY = 'matrx.swipePill.hidden';

export async function isSwipePillHidden(): Promise<boolean> {
  try {
    const got = await chrome.storage.local.get(SWIPE_PILL_HIDDEN_KEY);
    return got[SWIPE_PILL_HIDDEN_KEY] === true;
  } catch {
    return false;
  }
}

export async function hideSwipePill(): Promise<void> {
  try {
    await chrome.storage.local.set({ [SWIPE_PILL_HIDDEN_KEY]: true });
  } catch {
    /* extension context gone; the card is already removed from this page */
  }
}

/** Opening the extension brings the card back. */
export async function showSwipePillAgain(): Promise<void> {
  try {
    await chrome.storage.local.remove(SWIPE_PILL_HIDDEN_KEY);
  } catch {
    /* storage unavailable; nothing to clear */
  }
}

export function onSwipePillHiddenChange(fn: (hidden: boolean) => void): void {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(SWIPE_PILL_HIDDEN_KEY in changes)) return;
      fn(changes[SWIPE_PILL_HIDDEN_KEY]?.newValue === true);
    });
  } catch {
    /* storage events unavailable */
  }
}
