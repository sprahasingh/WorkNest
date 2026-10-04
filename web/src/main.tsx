import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import { AuthProvider } from "./auth/AuthProvider.tsx";
import { ThemeProvider } from "./theme/ThemeProvider.tsx";
import { AppRoutes } from "./routes.tsx";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary.tsx";
import { PullToRefresh } from "./components/PullToRefresh.tsx";
import { ImageViewerProvider } from "./components/ImageViewer.tsx";
import { FeedbackProvider } from "./features/feedback/FeedbackProvider.tsx";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <ImageViewerProvider>
              <FeedbackProvider>
                <RouteErrorBoundary>
                  <AppRoutes />
                </RouteErrorBoundary>
              </FeedbackProvider>
            </ImageViewerProvider>
            <PullToRefresh />
            <Toaster richColors position="top-right" />
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
