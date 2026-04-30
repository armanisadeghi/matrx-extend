import { SettingsView } from '@/features/settings/SettingsView';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';

const queryClient = new QueryClient();

function OptionsApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="mx-auto max-w-2xl py-8">
        <h1 className="mb-6 px-3 text-2xl font-semibold tracking-tight">Matrx Extend Settings</h1>
        <SettingsView />
      </div>
    </QueryClientProvider>
  );
}

const root = createRoot(document.getElementById('app')!);
root.render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
);
