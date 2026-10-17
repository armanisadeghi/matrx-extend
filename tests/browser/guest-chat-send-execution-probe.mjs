/** Read-only boundary evidence. Never calls a React handler or dispatches an action. */
export function createGuestSendExecutionProbe(composer, button, events = null) {
  const fiberKey = Object.keys(composer ?? {}).find((key) => key.startsWith('__reactFiber$'));
  const propsKey = Object.keys(button ?? {}).find((key) => key.startsWith('__reactProps$'));
  let fiber = fiberKey ? composer[fiberKey] : null;
  let conversationId = null;
  const stores = new Set();
  const seen = new Set();
  while (fiber && !seen.has(fiber)) {
    seen.add(fiber);
    if (!conversationId && typeof fiber.memoizedProps?.conversationId === 'string')
      conversationId = fiber.memoizedProps.conversationId;
    for (let context = fiber.dependencies?.firstContext; context; context = context.next) {
      const store = context.memoizedValue?.store;
      if (typeof store?.getState === 'function' && typeof store?.subscribe === 'function')
        stores.add(store);
    }
    fiber = fiber.return;
  }
  const matching = [...stores].filter(
    (store) => store.getState()?.instanceUserInput?.byConversationId?.[conversationId],
  );
  const store = matching.length === 1 ? matching[0] : null;
  let observing = false;
  let notifications = 0;
  let pendingObserved = false;
  let windowErrors = 0;
  let unhandledRejections = 0;
  // Do not read any event properties: error objects, messages and URLs may contain private data.
  const onError = () => {
    if (observing) windowErrors += 1;
  };
  const onRejection = () => {
    if (observing) unhandledRejections += 1;
  };
  events?.addEventListener('error', onError);
  events?.addEventListener('unhandledrejection', onRejection);
  const snapshot = () => {
    const state = store?.getState();
    const input = state?.instanceUserInput?.byConversationId?.[conversationId];
    const identity = state?.chatHost?.identity;
    const preSend = input?.preSend;
    return {
      storeLocated: Boolean(store),
      runtimeErrors: { windowErrors, unhandledRejections },
      buttonReactOnClickPresent: typeof button?.[propsKey]?.onClick === 'function',
      storeNotificationsAfterClick: notifications,
      pendingSubmissionObserved: pendingObserved,
      conversationPresent: Boolean(state?.conversations?.byConversationId?.[conversationId]),
      submissionPhase: ['idle', 'pending', 'persisted'].includes(input?.submissionPhase)
        ? input.submissionPhase
        : null,
      preSendStatus: ['preparing', 'failed'].includes(preSend?.status) ? preSend.status : null,
      preSendErrorPresent: Boolean(preSend?.error),
      draftLength: typeof input?.text === 'string' ? input.text.length : null,
      identityReady: identity?.authReady === true,
      authenticated: identity?.isAuthenticated === true,
      accessTokenPresent: Boolean(identity?.accessToken),
      fingerprintPresent: Boolean(identity?.fingerprintId),
    };
  };
  const unsubscribe = store?.subscribe(() => {
    if (!observing) return;
    notifications += 1;
    if (
      store.getState()?.instanceUserInput?.byConversationId?.[conversationId]?.submissionPhase ===
      'pending'
    )
      pendingObserved = true;
  });
  return {
    begin() {
      observing = true;
    },
    snapshot,
    stopSubscription() {
      unsubscribe?.();
      return snapshot();
    },
    stop() {
      observing = false;
      unsubscribe?.();
      events?.removeEventListener('error', onError);
      events?.removeEventListener('unhandledrejection', onRejection);
      return snapshot();
    },
  };
}
