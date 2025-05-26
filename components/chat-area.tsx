"use client"

import { useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MoreHorizontal, Sparkles, Leaf, PanelLeftClose, PanelRightClose, Copy, GitBranch, Edit } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

interface ChatAreaProps {
  toggleLeftSidebar: () => void
  toggleRightSidebar: () => void
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean
}

export default function ChatArea({
  toggleLeftSidebar,
  toggleRightSidebar,
  leftSidebarOpen,
  rightSidebarOpen,
}: ChatAreaProps) {
  const [messages, setMessages] = useState([
    {
      id: "1",
      role: "assistant",
      content: "Hi, how can I help you today?",
      timestamp: "0 sec ago",
      model: "GPT-4o",
      name: "My Bud",
    },
  ])

  const [input, setInput] = useState("")

  const copyMessageToClipboard = (content: string) => {
    navigator.clipboard
      .writeText(content)
      .then(() => {
        console.log("Message copied to clipboard")
      })
      .catch((err) => {
        console.error("Failed to copy message: ", err)
      })
  }

  return (
    <>
      {/* Chat Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={toggleLeftSidebar}>
            <span className="sr-only">Toggle left sidebar</span>
            <PanelLeftClose
              className={`h-4 w-4 transition-transform duration-300 ${!leftSidebarOpen ? "rotate-180" : ""}`}
            />
          </Button>
          <span className="font-medium">New Chat</span>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">GPT-4o</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={toggleRightSidebar}>
          <span className="sr-only">Toggle right sidebar</span>
          <PanelRightClose
            className={`h-4 w-4 transition-transform duration-300 ${!rightSidebarOpen ? "rotate-180" : ""}`}
          />
        </Button>
      </div>

      {/* Chat Messages */}
      <ScrollArea className="flex-1 p-4">
        {messages.map((message) => (
          <div key={message.id} className="mb-6 group">
            <div className="flex items-start gap-3">
              <Avatar className="h-8 w-8 bg-green-50">
                <Leaf className="h-5 w-5 text-green-500" />
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium">
                    {message.name} ({message.model})
                  </span>
                  <span className="text-xs text-muted-foreground">· {message.timestamp}</span>
                </div>
                <div className="text-sm">{message.content}</div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => copyMessageToClipboard(message.content)}>
                    <Copy className="mr-2 h-4 w-4" />
                    <span>Copy</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <GitBranch className="mr-2 h-4 w-4" />
                    <span>Branch</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Edit className="mr-2 h-4 w-4" />
                    <span>Edit</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </ScrollArea>

      {/* Chat Input */}
      <div className="p-4 border-t">
        <div className="relative">
          <div className="flex items-start gap-3">
            <Avatar className="mt-1 h-8 w-8">
              <img src="/vibrant-street-market.png" alt="User" />
            </Avatar>
            <div className="flex-1 border rounded-md p-2 min-h-[80px] focus-within:ring-1 focus-within:ring-ring">
              <Textarea
                placeholder="Send a message to My Bud"
                className="border-0 focus-visible:ring-0 resize-none p-0 shadow-none min-h-[60px]"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </div>
          </div>
          <Button
            size="sm"
            className="absolute bottom-3 right-3 h-8 w-8 rounded-full bg-green-100 hover:bg-green-200 text-green-700"
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  )
}
