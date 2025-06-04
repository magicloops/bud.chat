import { QueryClient } from '@tanstack/react-query'

// Create the query client with optimized defaults
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      gcTime: 1000 * 60 * 60 * 24, // 24 hours (formerly cacheTime)
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors
        if (error?.status >= 400 && error?.status < 500) {
          return false
        }
        return failureCount < 3
      },
      refetchOnWindowFocus: true,
      refetchOnMount: 'always',
    },
    mutations: {
      retry: false, // Don't retry mutations by default
    },
  },
})

export default queryClient