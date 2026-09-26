import { useAuth } from '@/hooks/use-auth';
import { openFirefoxSidebarFromGesture, openPanel, panelOpenRemedy } from '@/lib/panel/adapter';
import {
  clearCapturePagePanel,
  requestCapturePagePanel,
  type CapturePagePanelRequest,
} from '@/lib/panel/launch-intent';
import { Button } from '@ai-matrx/design-system';
import { ExternalLink, MessageSquare, ScanLine } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';

export function Popup() {
  const { error, signIn, status, user } = useAuth();
  const [panelError, setPanelError] = useState<string | null>(null);
  const pendingCaptureRequest = useRef<CapturePagePanelRequest | null>(null);
  const openSidePanel = async () => {
    setPanelError(null);
    // Firefox must receive sidebarAction.open() while this toolbar click is
    // still active. It is window-global, so no tab/window is passed.
    const firefoxAttempt = openFirefoxSidebarFromGesture();
    if (firefoxAttempt) {
      if (!firefoxAttempt.promise) {
        setPanelError(panelOpenRemedy(firefoxAttempt.reason));
        return;
      }
      try {
        await firefoxAttempt.promise;
        window.close();
      } catch (err) {
        setPanelError(panelOpenRemedy((err as Error)?.message ?? 'open-failed'));
      }
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId == null) {
      setPanelError(panelOpenRemedy('Matrx could not find this browser window.'));
      return;
    }
    const attempt = openPanel({ windowId: tab.windowId });
    if (!attempt.promise) {
      setPanelError(panelOpenRemedy(attempt.reason));
      return;
    }
    try {
      await attempt.promise;
      window.close();
    } catch (err) {
      setPanelError(panelOpenRemedy((err as Error)?.message ?? 'open-failed'));
    }
  };

  const reportCaptureWriteFailure = (request: CapturePagePanelRequest) => {
    void request.write.catch(() => {
      setPanelError("Couldn't prepare Capture page. Open Matrx and select Scrape.");
    });
  };

  const discardCaptureIntent = (request: CapturePagePanelRequest | null) => {
    if (!request) return Promise.resolve();
    return clearCapturePagePanel(request).finally(() => {
      if (pendingCaptureRequest.current?.intent.id === request.intent.id) {
        pendingCaptureRequest.current = null;
      }
    });
  };

  const openChat = async () => {
    // If Capture page just failed, wait for its exact write/remove sequence
    // before opening normally. An Open chat click must never inherit that
    // failed navigation request.
    await discardCaptureIntent(pendingCaptureRequest.current);
    await openSidePanel();
  };

  const openCapturePage = async () => {
    setPanelError(null);
    // Firefox must receive sidebarAction.open() before the first await. Its
    // window id arrives asynchronously afterwards, and the mounted panel's
    // storage listener picks up the window-bound intent when it is written.
    const firefoxAttempt = openFirefoxSidebarFromGesture();
    if (firefoxAttempt) {
      let request: CapturePagePanelRequest | null = null;
      const requestPromise = chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => {
          if (tab?.windowId == null) throw new Error('Matrx could not find this browser window.');
          request = requestCapturePagePanel(tab.windowId);
          pendingCaptureRequest.current = request;
          reportCaptureWriteFailure(request);
          return request;
        })
        .catch((err) => {
          setPanelError(panelOpenRemedy((err as Error)?.message ?? 'open-failed'));
          return null;
        });
      if (!firefoxAttempt.promise) {
        await discardCaptureIntent(await requestPromise);
        setPanelError(panelOpenRemedy(firefoxAttempt.reason));
        return;
      }
      try {
        await firefoxAttempt.promise;
        window.close();
      } catch (err) {
        await discardCaptureIntent(await requestPromise);
        setPanelError(panelOpenRemedy((err as Error)?.message ?? 'open-failed'));
      }
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId == null) {
      setPanelError(panelOpenRemedy('Matrx could not find this browser window.'));
      return;
    }
    const request = requestCapturePagePanel(tab.windowId);
    pendingCaptureRequest.current = request;
    reportCaptureWriteFailure(request);
    const attempt = openPanel({ windowId: tab.windowId });
    if (!attempt.promise) {
      await discardCaptureIntent(request);
      setPanelError(panelOpenRemedy(attempt.reason));
      return;
    }
    try {
      await attempt.promise;
      window.close();
    } catch (err) {
      await discardCaptureIntent(request);
      setPanelError(panelOpenRemedy((err as Error)?.message ?? 'open-failed'));
    }
  };

  return (
    <div className="space-y-3 p-3 dark:bg-background">
      <div className="text-sm font-semibold">Matrx Extend</div>
      {user ? (
        <>
          <div className="text-xs text-muted-foreground">{user.email}</div>
          <div className="grid gap-2">
            <Button onClick={() => void openChat()} className="justify-start">
              <MessageSquare className="size-4" /> Open chat
            </Button>
            <Button
              onClick={() => void openCapturePage()}
              variant="secondary"
              className="justify-start"
            >
              <ScanLine className="size-4" /> Capture page
            </Button>
          </div>
          {panelError && (
            <p role="alert" className="text-xs text-destructive">
              {panelError}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Sign in to start using the extension.</p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              Sign-in failed: {error}
            </p>
          )}
          <Button
            onClick={() => void signIn()}
            disabled={status === 'signing-in'}
            className="w-full"
          >
            <ExternalLink /> Sign in
          </Button>
        </>
      )}
    </div>
  );
}

const root = createRoot(document.getElementById('app')!);
root.render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
