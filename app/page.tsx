"use client"

import { useState } from "react"
import ChatSidebar from "@/components/chat-sidebar"
import ChatArea from "@/components/chat-area"
import SettingsPanel from "@/components/settings-panel"

export default function ChatApp() {
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Left Sidebar */}
      <div
        className={`transition-all duration-300 ease-in-out ${leftSidebarOpen ? "w-60 opacity-100" : "w-0 opacity-0"} overflow-hidden`}
      >
        <div className={`w-60 h-full ${!leftSidebarOpen && "invisible"}`}>
          <ChatSidebar />
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col border-l border-r">
        <ChatArea
          toggleLeftSidebar={() => setLeftSidebarOpen(!leftSidebarOpen)}
          toggleRightSidebar={() => setRightSidebarOpen(!rightSidebarOpen)}
          leftSidebarOpen={leftSidebarOpen}
          rightSidebarOpen={rightSidebarOpen}
        />
      </div>

      {/* Settings Panel */}
      <div
        className={`transition-all duration-300 ease-in-out ${rightSidebarOpen ? "w-80 opacity-100" : "w-0 opacity-0"} overflow-hidden`}
      >
        <div className={`w-80 h-full ${!rightSidebarOpen && "invisible"}`}>
          <SettingsPanel />
        </div>
      </div>
    </div>
  )
}
