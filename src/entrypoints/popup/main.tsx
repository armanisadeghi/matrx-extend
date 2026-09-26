import { useAuth } from '@/hooks/use-auth';
import { openFirefoxSidebarFromGesture, openPanel, panelOpenRemedy } from '@/lib/panel/adapter';
import {
  type CapturePagePanelRequest,
  armCapturePagePanel,
  clearCapturePagePanel,
  requestCapturePagePanel,
  waitForSidePanelContextId,
} from '@/lib/panel/launch-intent';
import { Button } from '@ai-matrx/design-system';
import { ExternalLink, MessageSquare, ScanLine } from 'lucide-react';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';

export function Popup() {
  const { error, signIn, status, user } = useAuth();
  const [panelError, setPanelError] = useState<string | null>(null);
  const [captureInFlight, setCaptureInFlight] = useState(false);

  const openSidePanel = async () => {
    setPanelError(null);
    // Firefox's sidebar opener must be the first operation after the click.
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

  const openCapturePage = async () => {
    setPanelError(null);
    setCaptureInFlight(true);
    let request: CapturePagePanelRequest | null = null;
    // Must happen before any query or storage await.
    const firefoxAttempt = openFirefoxSidebarFromGesture();
    const prepareRequest = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId == null) throw new Error('Matrx could not find this browser window.');
      request = requestCapturePagePanel(tab.windowId);
      await request.write;
    };

    try {
      if (firefoxAttempt) {
        if (!firefoxAttempt.promise) throw new Error(firefoxAttempt.reason);
        const [prepared, opened] = await Promise.allSettled([
          prepareRequest(),
          firefoxAttempt.promise,
        ]);
        if (prepared.status !== 'fulfilled') throw prepared.reason;
        if (opened.status !== 'fulfilled') throw opened.reason;
      } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.windowId == null) throw new Error('Matrx could not find this browser window.');
        request = requestCapturePagePanel(tab.windowId);
        const attempt = openPanel({ windowId: tab.windowId });
        if (!attempt.promise) throw new Error(attempt.reason);
        const [written, opened] = await Promise.allSettled([request.write, attempt.promise]);
        if (written.status !== 'fulfilled') throw written.reason;
        if (opened.status !== 'fulfilled') throw opened.reason;
      }
      if (!request) throw new Error("Couldn't prepare Capture page.");
      const contextId = await waitForSidePanelContextId(request.intent.windowId);
      if (!contextId)
        throw new Error('Matrx could not confirm the opened side panel. Please try again.');
      await armCapturePagePanel(request, contextId);
      window.close();
    } catch (err) {
      if (request) await clearCapturePagePanel(request);
      setPanelError(
        panelOpenRemedy(
          (err as Error)?.message ?? "Couldn't prepare Capture page. Open Matrx and select Scrape.",
        ),
      );
      setCaptureInFlight(false);
    }
  };

  return (
    <div className="space-y-3 p-3 dark:bg-background">
      <div className="text-sm font-semibold">Matrx Extend</div>
      {user ? (
        <>
          <div className="text-xs text-muted-foreground">{user.email}</div>
          <div className="grid gap-2">
            <Button
              onClick={() => void openSidePanel()}
              disabled={captureInFlight}
              className="justify-start"
            >
              <MessageSquare className="size-4" /> Open chat
            </Button>
            <Button
              onClick={() => void openCapturePage()}
              disabled={captureInFlight}
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
