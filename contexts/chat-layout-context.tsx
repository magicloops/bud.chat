"use client"

import { createContext, useContext } from 'react'

interface ChatLayoutContextType {
  toggleLeftSidebar: () => void
  toggleRightSidebar: () => void
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean
}

const ChatLayoutContext = createContext<ChatLayoutContextType | undefined>(undefined)

export function ChatLayoutProvider({ 
  children, 
  value 
}: { 
  children: React.ReactNode
  value: ChatLayoutContextType
}) {
  return (
    <ChatLayoutContext.Provider value={value}>
      {children}
    </ChatLayoutContext.Provider>
  )
}

export function useChatLayout() {
  const context = useContext(ChatLayoutContext)
  if (!context) {
    throw new Error('useChatLayout must be used within a ChatLayoutProvider')
  }
  return context
}