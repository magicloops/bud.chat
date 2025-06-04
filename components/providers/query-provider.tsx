'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import queryClient from '@/state/queryClient'

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Use the singleton query client
  const [client] = useState(() => queryClient)

  return (
    <QueryClientProvider client={client}>
      {children}
    </QueryClientProvider>
  )
}