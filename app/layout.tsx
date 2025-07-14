import type React from "react"
import "@/app/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { AuthProvider } from "@/lib/auth/auth-provider"
import { QueryProvider } from "@/components/providers/query-provider"
import { ModelProvider } from "@/contexts/model-context"
import { Toaster } from "@/components/ui/toaster"
import { DebugPanel } from "@/components/DebugPanel"

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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link 
          href="https://fonts.googleapis.com/css2?family=Pacifico&family=Griffy&family=Leckerli+One&family=Cherry+Bomb+One&family=Chewy&family=Jua&family=Schoolbell&family=Arbutus&family=Arbutus+Slab&family=Fauna+One&family=Nabla&family=Fleur+De+Leah&family=Permanent+Marker&family=Seaweed+Script&display=swap" 
          rel="stylesheet" 
        />
      </head>
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
            <DebugPanel />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}