"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

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
      {/* Show React Query DevTools in development */}
      {process.env.NODE_ENV === "development" && (
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
