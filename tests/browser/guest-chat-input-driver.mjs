import assert from 'node:assert/strict';
import { createGuestComposerProbe, readGuestReactDraft } from './guest-chat-completion-oracle.mjs';
import { createGuestSendExecutionProbe } from './guest-chat-send-execution-probe.mjs';
import { readPackageChatControls } from './package-chat-controls.mjs';

/** Captures the active pane and conversation, without exporting IDs or draft text. */
export function createGuestInputIntent(document, readDraft, expectedText) {
  const activePane = () => {
    const tab = document.querySelector('button[role="tab"][title="Chat"]');
    const pane = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
    return pane?.getAttribute('data-state') === 'active' ? pane : null;
  };
  const conversation = (composer) => {
    const key = Object.keys(composer ?? {}).find((key) => key.startsWith('__reactFiber$'));
    let fiber = key ? composer[key] : null;
    const seen = new Set();
    while (fiber && !seen.has(fiber)) {
      seen.add(fiber);
      if (typeof fiber.memoizedProps?.conversationId === 'string')
        return fiber.memoizedProps.conversationId;
      fiber = fiber.return;
    }
    return null;
  };
  const originalPane = activePane();
  const originalConversation = conversation(originalPane?.querySelector('textarea'));
  return () => {
    const pane = activePane();
    const composers = pane?.querySelectorAll('textarea') ?? [];
    const composer = composers.length === 1 ? composers[0] : null;
    return {
      uniqueComposer: composers.length === 1,
      sameActivePane: Boolean(pane && pane === originalPane && pane.isConnected),
      sameConversation: Boolean(
        originalConversation && conversation(composer) === originalConversation,
      ),
      currentNodeConnected: composer?.isConnected === true,
      currentNodeFocused: Boolean(composer && document.activeElement === composer),
      ...readDraft(composer, expectedText),
    };
  };
}

function requireCommittedIntent(intent, label) {
  for (const field of [
    'sameActivePane',
    'uniqueComposer',
    'sameConversation',
    'currentNodeConnected',
    'currentNodeFocused',
    'domMatchesExpected',
    'reactValueMatchesExpected',
    'reduxDraftMatchesExpected',
  ])
    assert.equal(intent?.[field], true, `${label} guest input intent must preserve ${field}`);
}

/** Shared guest input path; native CDP delivery stays at the browser boundary. */
export function createGuestInputDriver({ evaluate, waitFor, observe, click, report }) {
  async function installGuestComposerProbe(panel) {
    return evaluate(
      panel,
      `(() => {
      window.__guestChatComposerProbe?.stop();
      const makeProbe = (${createGuestComposerProbe.toString()});
      const readControls = (${readPackageChatControls.toString()});
      const pane = () => {
        const chat = document.querySelector('button[role="tab"][title="Chat"]');
        const current = document.getElementById(chat?.getAttribute('aria-controls') ?? '');
        return current?.getAttribute('data-state') === 'active' ? current : null;
      };
      window.__guestChatComposerProbe = makeProbe({
        findComposer: () => pane()?.querySelector('textarea') ?? null,
        activeElement: () => document.activeElement,
        sendEnabled: () => readControls(pane()).sendEnabled,
      });
      return window.__guestChatComposerProbe.snapshot();
    })()`,
    );
  }

  async function guestComposerSnapshot(panel) {
    return evaluate(panel, 'window.__guestChatComposerProbe?.snapshot() ?? null');
  }

  async function installGuestSendClickProbe(panel) {
    return evaluate(
      panel,
      `(() => {
      window.__guestChatSendClickProbe?.stop();
      const chat = document.querySelector('button[role="tab"][title="Chat"]');
      const pane = document.getElementById(chat?.getAttribute('aria-controls') ?? '');
      const send = pane?.getAttribute('data-state') === 'active'
        ? [...pane.querySelectorAll('button[aria-label="Send message"]')]
        : [];
      if (send.length !== 1) return { installed: false };
      let clickEvents = 0;
      let bubbleClickEvents = 0;
      let trustedClickEvents = 0;
      let intentMatchedAtClick = null;
      const hitsSend = (event) => event.target === send[0] || send[0].contains(event.target);
      const capture = (event) => {
        if (!hitsSend(event)) return;
        window.__guestChatSendExecutionProbe?.begin();
        clickEvents += 1;
        const intent = window.__guestChatInputIntent?.();
        intentMatchedAtClick = intent ? ['sameActivePane', 'uniqueComposer', 'sameConversation', 'currentNodeConnected',
          'domMatchesExpected', 'reactValueMatchesExpected', 'reduxDraftMatchesExpected']
          .every((field) => intent[field] === true) : null;
        if (event.isTrusted) trustedClickEvents += 1;
        if (intent && (intentMatchedAtClick !== true || !event.isTrusted)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };
      const bubble = (event) => {
        if (hitsSend(event)) bubbleClickEvents += 1;
      };
      document.addEventListener('click', capture, true);
      document.addEventListener('click', bubble);
      const snapshot = () => {
        const composer = pane.querySelector('textarea');
        return {
          clickEvents,
          bubbleClickEvents,
          trustedClickEvents,
          intentMatchedAtClick,
          buttonConnected: send[0].isConnected && pane.contains(send[0]),
          composerLength: composer?.value?.length ?? 0,
          userMessageCount: pane.querySelectorAll('[role="article"][aria-label="Your message"]').length,
          sendEnabled: !send[0].disabled && send[0].getAttribute('aria-disabled') !== 'true',
        };
      };
      window.__guestChatSendClickProbe = {
        stop: () => {
          document.removeEventListener('click', capture, true);
          document.removeEventListener('click', bubble);
          return snapshot();
        },
      };
      return { installed: true, beforeClick: snapshot() };
    })()`,
    );
  }

  async function submitQuestion(panel, question, label, mode, readDraft = readGuestReactDraft) {
    const boundary = mode === 'package' ? { attempt: label } : null;
    let phase = 'focus';
    if (boundary) report.composer_input_boundaries.push(boundary);
    const snapshot = async () => {
      if (!boundary) return;
      try {
        return await guestComposerSnapshot(panel);
      } catch {
        boundary.probe_failure = 'snapshot_unavailable';
        return null;
      }
    };
    if (boundary) {
      await evaluate(
        panel,
        `window.__guestChatInputIntent = (${createGuestInputIntent.toString()})(document, (${readDraft.toString()}), ${JSON.stringify(question)})`,
      );
      try {
        boundary.before_focus = await installGuestComposerProbe(panel);
      } catch {
        boundary.probe_failure = 'install_unavailable';
      }
    }
    try {
      const focused = await evaluate(
        panel,
        `(() => {
      const chat = document.querySelector('button[role="tab"][title="Chat"]');
      const pane = document.getElementById(chat?.getAttribute('aria-controls') ?? '');
      const textarea = pane?.querySelector('textarea');
      textarea?.focus();
      const current = pane?.querySelector('textarea');
      return Boolean(current?.isConnected && document.activeElement === current);
    })()`,
      );
      if (boundary) {
        boundary.after_focus = await snapshot();
        const intent = await evaluate(panel, 'window.__guestChatInputIntent()');
        for (const field of [
          'sameActivePane',
          'uniqueComposer',
          'sameConversation',
          'currentNodeConnected',
          'currentNodeFocused',
        ])
          assert.equal(
            intent?.[field],
            true,
            `${label} focused guest composer must preserve ${field}`,
          );
      }
      assert.equal(focused, true, `${label} guest Chat composer must focus`);
      phase = 'insert';
      await panel.send('Input.insertText', { text: question });
      if (boundary) {
        boundary.after_insert = await snapshot();
        boundary.react_after_insert = await evaluate(
          panel,
          `(() => {
        const chat = document.querySelector('button[role="tab"][title="Chat"]');
        const pane = document.getElementById(chat?.getAttribute('aria-controls') ?? '');
        return (${readDraft.toString()})(pane?.querySelector('textarea'), ${JSON.stringify(question)});
      })()`,
        );
      }
      // Compare input paths on the active composer, which React may remount on focus. Both are native CDP input;
      // key events additionally traverse React's keyboard path. Never set DOM values.
      if (boundary) {
        phase = 'keyboard_comparison';
        await panel.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'a',
          code: 'KeyA',
          modifiers: 4,
          windowsVirtualKeyCode: 65,
          commands: ['selectAll'],
        });
        await panel.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'a',
          code: 'KeyA',
          modifiers: 4,
          windowsVirtualKeyCode: 65,
        });
        await panel.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8,
        });
        await panel.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8,
        });
        boundary.after_keyboard_clear = await snapshot();
        assert.equal(
          boundary.after_keyboard_clear?.currentValueLength,
          0,
          'keyboard comparison must clear the existing draft through native input',
        );
        for (const character of question) {
          await panel.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: character,
            text: character,
          });
          await panel.send('Input.dispatchKeyEvent', { type: 'keyUp', key: character });
        }
        boundary.after_keyboard = await snapshot();
        boundary.react_after_keyboard = await evaluate(panel, 'window.__guestChatInputIntent()');
        requireCommittedIntent(boundary.react_after_keyboard, label);
        boundary.submitted_input_method = 'native_key_events_after_insert_text_comparison';
      }
      phase = 'send_ready_wait';
      await waitFor(
        `${label}_send_ready`,
        () => observe(panel),
        (state) => state?.sendEnabled,
        10_000,
      );
      if (boundary) boundary.wait = { outcome: 'send_ready', snapshot: await snapshot() };
      phase = 'click';
      if (boundary) {
        boundary.intent_before_click = await evaluate(panel, 'window.__guestChatInputIntent()');
        requireCommittedIntent(boundary.intent_before_click, label);
        boundary.execution_before_click = await evaluate(
          panel,
          `(() => {
          window.__guestChatSendExecutionProbe?.stop();
          const pane = document.getElementById(document.querySelector('button[role="tab"][title="Chat"]')?.getAttribute('aria-controls') ?? '');
          window.__guestChatSendExecutionProbe = (${createGuestSendExecutionProbe.toString()})(pane?.querySelector('textarea'), pane?.querySelector('button[aria-label="Send message"]'), window);
          return window.__guestChatSendExecutionProbe.snapshot();
        })()`,
        );
        const installed = await installGuestSendClickProbe(panel);
        assert.equal(installed?.installed, true, `${label} send click probe must attach`);
        boundary.click = { phases: [], beforeClick: installed.beforeClick, afterClick: null };
      }
      await click(panel, 'chat-send', '', (step) => {
        if (boundary) boundary.click.phases.push(step);
      });
      if (boundary) {
        boundary.click.afterClick = await evaluate(
          panel,
          'window.__guestChatSendClickProbe?.stop() ?? null',
        );
        assert.equal(
          boundary.click.afterClick?.clickEvents,
          1,
          `${label} Send must receive exactly one click`,
        );
        assert.equal(
          boundary.click.afterClick?.trustedClickEvents,
          1,
          `${label} Send must receive a trusted native click`,
        );
        assert.equal(
          boundary.click.afterClick?.intentMatchedAtClick,
          true,
          `${label} Send must target the committed input intent`,
        );
        assert.equal(
          boundary.click.afterClick?.bubbleClickEvents,
          1,
          `${label} Send must bubble to the document`,
        );
      }
    } catch (error) {
      if (boundary && !boundary.wait)
        boundary.wait = {
          outcome: phase === 'send_ready_wait' ? 'send_not_ready' : `${phase}_failed`,
          snapshot: await snapshot(),
        };
      throw error;
    } finally {
      if (boundary) {
        boundary.execution_after_click = await evaluate(
          panel,
          'window.__guestChatSendExecutionProbe?.snapshot() ?? null',
        ).catch(() => null);
        if (boundary.click && !boundary.click.afterClick)
          boundary.click.afterClick = await evaluate(
            panel,
            'window.__guestChatSendClickProbe?.stop() ?? null',
          ).catch(() => null);
        await evaluate(
          panel,
          'window.__guestChatComposerProbe?.stop(); delete window.__guestChatInputIntent;',
        ).catch(() => {});
      }
    }
  }

  return submitQuestion;
}
