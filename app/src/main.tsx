import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import './index.css';
import App from './App.tsx';
import { AppRoot } from './AppRoot.tsx';
import { queryClient } from './api/queryClient.ts';
import { ToastProvider } from './ui/ToastContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AppRoot>
            <App />
          </AppRoot>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
