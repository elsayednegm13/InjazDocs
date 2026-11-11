import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { SessionProvider } from "@/app/session";
import { AppRouter } from "@/app/router";
import { Toasts } from "@/components/ui/toaster";
import { ApiRequestError } from "@/lib/api";
import { retryReadQuery } from "@/lib/query-retry";
import { notifyError, notifySuccess } from "@/lib/notify";
import { initOfflineOutboxListeners, onOfflineSyncComplete } from "@/lib/offline-outbox";
import "./app/i18n";
import "./index.css";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: retryReadQuery,
      staleTime: 90_000,
      refetchOnWindowFocus: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiRequestError && error.status === 401) return;
      notifyError(error);
    },
  }),
});

initOfflineOutboxListeners();
onOfflineSyncComplete((syncedCount) => {
  void client.invalidateQueries();
  notifySuccess(`تمت مزامنة ${syncedCount} تعديلات محفوظة محلياً مع الخادم بنجاح`);
});

window.addEventListener("unhandledrejection", (event) => {
  notifyError(event.reason);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <SessionProvider>
          <AppRouter />
          <Toasts />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
