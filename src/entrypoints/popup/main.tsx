import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { ExternalLink, MessageSquare, ScanLine } from 'lucide-react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';

function Popup() {
  const { user, signIn } = useAuth();
  const openSidePanel = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.windowId) return;
    await chrome.sidePanel.open({ windowId: tab.windowId });
    window.close();
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
