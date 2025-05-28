"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ChevronDown, ChevronRight, HelpCircle, Leaf, Palette } from "lucide-react"
import { useModel } from "@/contexts/model-context"
import { useToast } from "@/hooks/use-toast"

export default function SettingsPanel() {
  const [budSettingsOpen, setBudSettingsOpen] = useState(true)
  const [chatSettingsOpen, setChatSettingsOpen] = useState(true)
  const [helpersOpen, setHelpersOpen] = useState(true)
  const [showThemeDialog, setShowThemeDialog] = useState(false)
  const [themePrompt, setThemePrompt] = useState("")
  const [isGeneratingTheme, setIsGeneratingTheme] = useState(false)
  const { selectedModel, setSelectedModel } = useModel()
  const { toast } = useToast()

  // Load saved theme on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('customTheme')
    if (savedTheme) {
      try {
        const theme = JSON.parse(savedTheme)
        const root = document.documentElement
        Object.entries(theme.cssVariables).forEach(([key, value]) => {
          root.style.setProperty(key, value as string)
        })
      } catch (error) {
        console.error('Error loading saved theme:', error)
      }
    }
  }, [])

  const generateTheme = async () => {
    if (!themePrompt.trim()) {
      toast({
        title: "Error",
        description: "Please enter a theme description",
        variant: "destructive",
      })
      return
    }

    setIsGeneratingTheme(true)
    try {
      const response = await fetch('/api/generate-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: themePrompt })
      })

      if (response.ok) {
        const themeData = await response.json()
        
        // Apply the theme to the document
        const root = document.documentElement
        Object.entries(themeData.cssVariables).forEach(([key, value]) => {
          root.style.setProperty(key, value as string)
        })

        // Store theme in localStorage
        localStorage.setItem('customTheme', JSON.stringify(themeData))

        toast({
          title: "Theme Applied!",
          description: `Applied ${themeData.name} theme`,
        })
        
        setShowThemeDialog(false)
        setThemePrompt("")
      } else {
        throw new Error('Failed to generate theme')
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate theme",
        variant: "destructive",
      })
    } finally {
      setIsGeneratingTheme(false)
    }
  }

  const resetTheme = () => {
    // Remove custom theme
    localStorage.removeItem('customTheme')
    
    // Reset CSS variables to default
    const root = document.documentElement
    const defaultTheme = {
      '--background': '0 0% 100%',
      '--foreground': '222.2 84% 4.9%',
      '--card': '0 0% 100%',
      '--card-foreground': '222.2 84% 4.9%',
      '--popover': '0 0% 100%',
      '--popover-foreground': '222.2 84% 4.9%',
      '--primary': '222.2 47.4% 11.2%',
      '--primary-foreground': '210 40% 98%',
      '--secondary': '210 40% 96%',
      '--secondary-foreground': '222.2 84% 4.9%',
      '--muted': '210 40% 96%',
      '--muted-foreground': '215.4 16.3% 46.9%',
      '--accent': '210 40% 96%',
      '--accent-foreground': '222.2 84% 4.9%',
      '--destructive': '0 84.2% 60.2%',
      '--destructive-foreground': '210 40% 98%',
      '--border': '214.3 31.8% 91.4%',
      '--input': '214.3 31.8% 91.4%',
      '--ring': '222.2 84% 4.9%',
      '--radius': '0.5rem',
    }
    
    Object.entries(defaultTheme).forEach(([key, value]) => {
      root.style.setProperty(key, value)
    })

    toast({
      title: "Theme Reset",
      description: "Restored default theme",
    })
  }

  return (
    <div className="h-full bg-background border-l overflow-hidden flex flex-col">
      <ScrollArea className="h-full flex-1 overflow-auto">
        <div className="p-4 space-y-6">
          {/* Bud Settings */}
          <Collapsible open={budSettingsOpen} onOpenChange={setBudSettingsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="flex w-full items-center justify-between p-0 h-auto">
                <div className="flex items-center gap-2">
                  <ChevronRight className={`h-5 w-5 transition-transform ${budSettingsOpen ? "rotate-90" : ""}`} />
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
                <div className="flex justify-start gap-2">
                  <div className="border rounded-md p-4 w-16 h-16 flex items-center justify-center">
                    <Leaf className="h-8 w-8 text-green-500" />
                  </div>
                  {/* Secret theme generator */}
                  <div 
                    className="border rounded-md p-4 w-16 h-16 flex items-center justify-center cursor-pointer hover:bg-accent transition-colors"
                    onClick={() => setShowThemeDialog(true)}
                    title="Secret theme generator"
                  >
                    <Palette className="h-8 w-8 text-muted-foreground hover:text-foreground transition-colors" />
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
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="o3">OpenAI: o3</SelectItem>
                    <SelectItem value="o1">OpenAI: o1</SelectItem>
                    <SelectItem value="o1-mini">OpenAI: o1-mini</SelectItem>
                    <SelectItem value="gpt-4o">OpenAI: GPT-4o</SelectItem>
                    <SelectItem value="gpt-4o-mini">OpenAI: GPT-4o-mini</SelectItem>
                    <SelectItem value="gpt-4-turbo">OpenAI: GPT-4 Turbo</SelectItem>
                    <SelectItem value="gpt-4">OpenAI: GPT-4</SelectItem>
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

      {/* Secret Theme Generator Dialog */}
      <Dialog open={showThemeDialog} onOpenChange={setShowThemeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>🎨 AI Theme Generator</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Describe your ideal theme</label>
              <Textarea
                placeholder="e.g., 'Dark cyberpunk with neon accents' or 'Warm sunset colors with soft gradients'"
                value={themePrompt}
                onChange={(e) => setThemePrompt(e.target.value)}
                className="mt-2 min-h-[100px]"
              />
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={generateTheme}
                disabled={isGeneratingTheme || !themePrompt.trim()}
                className="flex-1"
              >
                {isGeneratingTheme ? "Generating..." : "Generate Theme"}
              </Button>
              <Button 
                variant="outline" 
                onClick={resetTheme}
                className="flex-1"
              >
                Reset to Default
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Powered by o3 • Themes are applied instantly and saved locally
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
