import { RootErrorBoundary } from '@/components/RootErrorBoundary';
import { ScreenshotEditor } from '@/features/screenshots/editor/ScreenshotEditor';
import { parseEditorQuery } from '@/features/screenshots/links';
import { initAppConfig } from '@/lib/config';
import { TooltipProvider } from '@ai-matrx/design-system';
import { installOutboundReferralDecorator } from '@ai-matrx/kit/outbound-react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';

// The website links (Files, image editor) are read from stored app config.
await initAppConfig();
// Backend selection lives in the persisted settings store; downloads go to that backend.
const { useSettingsStore } = await import('@/state/settings');
if (!useSettingsStore.persist.hasHydrated()) {
  await new Promise<void>((resolve) => {
    const off = useSettingsStore.persist.onFinishHydration(() => {
      off();
      resolve();
    });
    if (useSettingsStore.persist.hasHydrated()) resolve();
  });
}
installOutboundReferralDecorator();

const target = parseEditorQuery(window.location.search);

const root = createRoot(document.getElementById('app')!);
root.render(
  <React.StrictMode>
    <RootErrorBoundary>
      <TooltipProvider delayDuration={150}>
        {target ? (
          <ScreenshotEditor target={target} />
        ) : (
          <p className="p-6 text-sm">No screenshot was given to edit.</p>
        )}
      </TooltipProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
);
