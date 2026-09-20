import { useAuth } from '@/hooks/use-auth';
import { openFirefoxSidebarFromGesture, openPanel, panelOpenRemedy } from '@/lib/panel/adapter';
import { Button } from '@ai-matrx/design-system';
import { ExternalLink, MessageSquare, ScanLine } from 'lucide-react';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';

export function Popup() {
  const { user, signIn } = useAuth();
  const [panelError, setPanelError] = useState<string | null>(null);
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

  return (
    <div className="space-y-3 p-3 dark:bg-background">
      <div className="text-sm font-semibold">Matrx Extend</div>
      {user ? (
        <>
          <div className="text-xs text-muted-foreground">{user.email}</div>
          <div className="grid gap-2">
            <Button onClick={() => void openSidePanel()} className="justify-start">
              <MessageSquare className="size-4" /> Open chat
            </Button>
            <Button
              onClick={() => void openSidePanel()}
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
          <Button onClick={signIn} className="w-full">
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
