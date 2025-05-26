"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChevronDown, ChevronRight, HelpCircle, Leaf } from "lucide-react"

export default function SettingsPanel() {
  const [chatSettingsOpen, setChatSettingsOpen] = useState(true)
  const [helpersOpen, setHelpersOpen] = useState(true)

  return (
    <div className="h-full bg-background border-l overflow-hidden flex flex-col">
      <ScrollArea className="h-full flex-1 overflow-auto">
        <div className="p-4 space-y-6">
          {/* Bud Settings */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="flex w-full items-center justify-between p-0 h-auto">
                <div className="flex items-center gap-2">
                  <ChevronRight className={`h-5 w-5 transition-transform ${open ? "rotate-90" : ""}`} />
                  <span className="text-lg font-semibold">Bud Settings</span>
                </div>
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">{/* Bud settings content would go here */}</CollapsibleContent>
          </Collapsible>

          {/* Chat Settings */}
          <Collapsible open={chatSettingsOpen} onOpenChange={setChatSettingsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="flex w-full items-center justify-between p-0 h-auto">
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={`h-5 w-5 transition-transform ${!chatSettingsOpen ? "rotate-[-90deg]" : ""}`}
                  />
                  <span className="text-lg font-semibold">Chat Settings</span>
                </div>
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4 space-y-6">
              {/* Chat Emoji */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Chat Emoji</label>
                <div className="flex justify-start">
                  <div className="border rounded-md p-4 w-16 h-16 flex items-center justify-center">
                    <Leaf className="h-8 w-8 text-green-500" />
                  </div>
                </div>
              </div>

              {/* Chat Name */}
              <div className="space-y-2">
                <label htmlFor="chat-name" className="text-sm font-medium">
                  Chat Name
                </label>
                <Input id="chat-name" placeholder="(Optional) Name this chat..." className="resize-none" />
              </div>

              {/* AI Model */}
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <label className="text-sm font-medium">AI Model</label>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </div>
                <Select defaultValue="gpt-4o">
                  <SelectTrigger>
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-4o">OpenAI: GPT-4o</SelectItem>
                    <SelectItem value="gpt-4">OpenAI: GPT-4</SelectItem>
                    <SelectItem value="gpt-3.5-turbo">OpenAI: GPT-3.5 Turbo</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* AI Goals / Instructions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="ai-goals" className="text-sm font-medium">
                    AI Goals / Instructions
                  </label>
                </div>
                <Textarea
                  id="ai-goals"
                  placeholder="Your Bud's goal, personality, and info it needs. (Recommended)"
                  className="min-h-[100px] resize-none"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Advanced */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="flex w-full items-center justify-between p-0 h-auto">
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-5 w-5" />
                  <span className="text-lg font-semibold">Advanced</span>
                </div>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">{/* Advanced settings content would go here */}</CollapsibleContent>
          </Collapsible>

          {/* Helpers */}
          <Collapsible open={helpersOpen} onOpenChange={setHelpersOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="flex w-full items-center justify-between p-0 h-auto">
                <div className="flex items-center gap-2">
                  <ChevronDown className={`h-5 w-5 transition-transform ${!helpersOpen ? "rotate-[-90deg]" : ""}`} />
                  <span className="text-lg font-semibold">Helpers</span>
                </div>
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-12">
                  Plan
                </Button>
                <Button variant="outline" className="h-12">
                  Design
                </Button>
                <Button variant="outline" className="h-12">
                  Code
                </Button>
                <Button variant="outline" className="h-12">
                  Code Review
                </Button>
                <Button variant="outline" className="h-12 col-span-2">
                  Debug
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
  )
}
