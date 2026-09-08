import { RealtimeHost } from '@/components/RealtimeHost';
import { RootErrorBoundary } from '@/components/RootErrorBoundary';
import { log, startDebugRelay } from '@/lib/debug/log';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@/styles/globals.css';

startDebugRelay();
log.info('sys', 'sidepanel mounted');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const root = createRoot(document.getElementById('app')!);
root.render(
  <React.StrictMode>
    {/* Outermost, so it catches provider-level failures too. A blank panel is
        the least debuggable outcome available — this turns any render throw
        into a readable message plus a stack. */}
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* The sidepanel's ONE realtime manager + write ledger. Every channel
            in this realm hangs off it; a second provider would be a second
            ledger, under which our own writes classify as remote. */}
        <RealtimeHost>
          <App />
        </RealtimeHost>
      </QueryClientProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
);
