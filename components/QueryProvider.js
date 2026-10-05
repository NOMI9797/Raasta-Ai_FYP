"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState } from "react";

// The devtools panel is a 1.2 MB script that slows every screen in `npm run dev`, so it is opt-in:
// set QUERY_DEVTOOLS=true in .env.local when you want it. next.config.js turns that into a build-time
// constant, which keeps the panel (and its code) out of the page when it is off.
const ReactQueryDevtools =
  process.env.NEXT_PUBLIC_QUERY_DEVTOOLS === "true"
    ? dynamic(() => import("@tanstack/react-query-devtools").then((mod) => mod.ReactQueryDevtools), { ssr: false })
    : null;

// Create a custom QueryProvider component
const QueryProvider = ({ children }) => {
  // Create a new QueryClient instance for each component tree
  // This ensures that data is not shared between different users in SSR
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Time in milliseconds that unused/inactive cache data remains in memory
            gcTime: 1000 * 60 * 60 * 24, // 24 hours
            // Time in milliseconds after data is considered stale
            staleTime: 1000 * 60 * 5, // 5 minutes
            // Retry failed requests
            retry: (failureCount, error) => {
              // Don't retry on 4xx errors (client errors)
              if (error?.status >= 400 && error?.status < 500) {
                return false;
              }
              // Retry up to 3 times for other errors
              return failureCount < 3;
            },
            // Refetch on window focus (when user comes back to tab)
            refetchOnWindowFocus: false,
            // Refetch on reconnect
            refetchOnReconnect: true,
            // Refetch on mount if data is stale
            refetchOnMount: true,
          },
          mutations: {
            // Retry failed mutations
            retry: (failureCount, error) => {
              // Don't retry on 4xx errors (client errors)
              if (error?.status >= 400 && error?.status < 500) {
                return false;
              }
              // Retry up to 2 times for other errors
              return failureCount < 2;
            },
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* React Query DevTools, only when QUERY_DEVTOOLS=true */}
      {ReactQueryDevtools && (
        <ReactQueryDevtools
          initialIsOpen={false}
          position="bottom-right"
          buttonPosition="bottom-right"
        />
      )}
    </QueryClientProvider>
  );
};

export default QueryProvider;
