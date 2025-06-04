import type React from "react"
import "@/app/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { AuthProvider } from "@/lib/auth/auth-provider"
import { QueryProvider } from "@/components/providers/query-provider"
import { ModelProvider } from "@/contexts/model-context"
import { Toaster } from "@/components/ui/toaster"

export const metadata = {
  title: "bud.chat",
  description: "A branch-first LLM chat interface with conversation forking",
  generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="h-full">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          storageKey="bud-chat-theme"
        >
          <AuthProvider>
            <QueryProvider>
              <ModelProvider>
                {children}
              </ModelProvider>
            </QueryProvider>
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}