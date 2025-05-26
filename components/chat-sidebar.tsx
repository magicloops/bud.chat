"use client"

import type React from "react"

import { useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Plus, Users, Lock, Globe, LogOut, Leaf } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"

type ChatItem = {
  id: string
  icon: React.ReactNode
  title: string
  locked?: boolean
}

export default function ChatSidebar() {
  const [chatItems, setChatItems] = useState<ChatItem[]>([
    { id: "1", icon: <Users size={16} />, title: "Shared" },
    {
      id: "2",
      icon: (
        <Avatar className="h-4 w-4">
          <img src="/abstract-geometric-aw.png" alt="AW" />
        </Avatar>
      ),
      title: "Adam Williams",
      locked: true,
    },
    {
      id: "3",
      icon: (
        <Avatar className="h-4 w-4 bg-blue-100">
          <Leaf className="h-3 w-3 text-green-500" />
        </Avatar>
      ),
      title: "Neovim Aliasing",
    },
    {
      id: "4",
      icon: (
        <Avatar className="h-4 w-4 bg-blue-100">
          <Leaf className="h-3 w-3 text-green-500" />
        </Avatar>
      ),
      title: "Neovim Aliasing",
    },
    {
      id: "5",
      icon: (
        <Avatar className="h-4 w-4 bg-blue-100">
          <Leaf className="h-3 w-3 text-green-500" />
        </Avatar>
      ),
      title: "SSH Setup With GitHub",
    },
    {
      id: "6",
      icon: (
        <Avatar className="h-4 w-4 bg-blue-100">
          <Leaf className="h-3 w-3 text-green-500" />
        </Avatar>
      ),
      title: "MacOS Developer Utilities",
    },
    {
      id: "7",
      icon: (
        <Avatar className="h-4 w-4 bg-blue-100">
          <Leaf className="h-3 w-3 text-green-500" />
        </Avatar>
      ),
      title: "JSX with No Loop Fix",
    },
    { id: "8", icon: <Avatar className="h-4 w-4 bg-yellow-100">🤖</Avatar>, title: "JSON Object Parsing" },
    { id: "9", icon: <Avatar className="h-4 w-4 bg-yellow-100">🤖</Avatar>, title: "Ensure useEffect Only..." },
    {
      id: "10",
      icon: (
        <Avatar className="h-4 w-4 bg-blue-100">
          <Leaf className="h-3 w-3 text-green-500" />
        </Avatar>
      ),
      title: "Zoning Provisions for...",
    },
    {
      id: "11",
      icon: (
        <Avatar className="h-4 w-4 bg-blue-100">
          <Leaf className="h-3 w-3 text-green-500" />
        </Avatar>
      ),
      title: "Token Price Calculation...",
    },
    { id: "12", icon: <Avatar className="h-4 w-4 bg-gray-100">🏛️</Avatar>, title: "H-1b Processing Time" },
  ])

  return (
    <div className="w-60 h-full flex flex-col bg-background border-r">
      <div className="p-3">
        <Button variant="outline" className="w-full justify-start gap-2">
          <Plus size={16} />
          <span>New chat</span>
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-1">
          {chatItems.map((item) => (
            <Button
              key={item.id}
              variant={item.id === "2" ? "secondary" : "ghost"}
              className="w-full justify-start gap-2 mb-1 text-sm font-normal"
            >
              <span className="flex items-center justify-center w-5 h-5">{item.icon}</span>
              <span className="truncate">{item.title}</span>
              {item.locked && <Lock className="ml-auto h-3 w-3 opacity-70" />}
            </Button>
          ))}
        </div>
      </ScrollArea>

      <div className="mt-auto p-2 space-y-1">
        <ThemeToggle />
        <Button variant="ghost" className="w-full justify-start gap-2 text-sm font-normal">
          <Globe size={16} />
          <span>Add to Slack</span>
        </Button>
        <Button variant="ghost" className="w-full justify-start gap-2 text-sm font-normal">
          <Avatar className="h-4 w-4">
            <img src="/abstract-geometric-aw.png" alt="AW" />
          </Avatar>
          <span>Adam Williams</span>
        </Button>
        <Button variant="ghost" className="w-full justify-start gap-2 text-sm font-normal">
          <LogOut size={16} />
          <span>Sign Out</span>
        </Button>
        <div className="px-2 py-1 text-xs text-muted-foreground">Bud is planted with 💚 in San Francisco</div>
      </div>
    </div>
  )
}
