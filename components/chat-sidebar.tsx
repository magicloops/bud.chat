"use client"

import { useState, useEffect, useMemo, useCallback, memo, useRef } from "react"
import { useRouter } from "next/navigation"
import { mutate } from 'swr'
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { 
  Plus, 
  Users, 
  MessageCircle, 
  LogOut, 
  Leaf, 
  MoreHorizontal, 
  Trash2, 
  Edit,
  ChevronDown,
  Building,
  Loader2
} from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuth } from "@/lib/auth/auth-provider"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useConversations } from "@/hooks/use-conversations"
import { useToast } from "@/hooks/use-toast"
import { Database } from "@/lib/types/database"

type Workspace = Database['public']['Tables']['workspace']['Row']
type Conversation = Database['public']['Tables']['conversation']['Row']

// Memoized conversation item component to prevent unnecessary re-renders
const ConversationItem = memo(function ConversationItem({ 
  conversation, 
  isSelected, 
  onConversationClick, 
  onDeleteConversation,
  onStartRename,
  formattedDate,
  isDropdownActive,
  onDropdownToggle,
  onConversationHover
}: {
  conversation: Conversation
  isSelected: boolean
  onConversationClick: (id: string) => void
  onDeleteConversation: (id: string) => void
  onStartRename: (conversation: Conversation) => void
  formattedDate: string
  isDropdownActive: boolean
  onDropdownToggle: (id: string, isOpen: boolean) => void
  onConversationHover: (id: string) => void
}) {
  const handleClick = useCallback(() => {
    onConversationClick(conversation.id)
  }, [onConversationClick, conversation.id])

  const handleDelete = useCallback(() => {
    onDeleteConversation(conversation.id)
  }, [onDeleteConversation, conversation.id])

  const handleRename = useCallback(() => {
    onStartRename(conversation)
  }, [onStartRename, conversation])

  const handleDropdownChange = useCallback((isOpen: boolean) => {
    onDropdownToggle(conversation.id, isOpen)
  }, [onDropdownToggle, conversation.id])

  const handleHover = useCallback(() => {
    onConversationHover(conversation.id)
  }, [onConversationHover, conversation.id])

  return (
    <div
      className={`group mb-1 mx-2 rounded-md hover:bg-accent ${
        isSelected ? "bg-accent" : ""
      }`}
    >
      <div className="flex items-center max-w-full">
        <button
          className="flex items-center gap-2 text-sm font-normal py-2 px-3 text-left flex-1 min-w-0 rounded-md"
          onClick={handleClick}
          onMouseEnter={handleHover}
        >
          <div className="flex-1 min-w-0">
            <div className="truncate">{conversation.title || "Untitled"}</div>
            <div className="text-xs text-muted-foreground">
              {formattedDate}
            </div>
          </div>
        </button>
        
        {/* Only render dropdown when it's the active one - saves tons of performance */}
        {isSelected && (
        <DropdownMenu open={isDropdownActive} onOpenChange={handleDropdownChange}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mr-1"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          {/* Only render content when dropdown is active */}
          {isDropdownActive && (
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleRename}>
                <Edit className="mr-2 h-4 w-4" />
                <span>Rename</span>
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={handleDelete}
                className="text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          )}
        </DropdownMenu>
        )}
      </div>
    </div>
  )
})

interface ChatSidebarProps {
  selectedConversationId?: string | null
  onConversationSelect: (conversation: Conversation, workspace: Workspace) => void
  onConversationUpdate?: (conversation: Conversation) => void
  onConversationChange?: (conversationId: string, workspaceId: string, title?: string, messages?: any[]) => void
}

function ChatSidebar({ selectedConversationId, onConversationSelect, onConversationUpdate, onConversationChange }: ChatSidebarProps) {
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
  const [newWorkspaceName, setNewWorkspaceName] = useState("")
  const [showNewWorkspaceDialog, setShowNewWorkspaceDialog] = useState(false)
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null)
  const [renamingConversation, setRenamingConversation] = useState<{ id: string; title: string } | null>(null)
  
  const { user, signOut } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  
  const { workspaces, loading: workspacesLoading, createWorkspace } = useWorkspaces()
  const { conversations, loading: conversationsLoading, createConversation, deleteConversation } = useConversations(
    selectedWorkspace?.id || null,
    onConversationUpdate
  )

  // Memoize conversation click handler to prevent re-creating on every render
  const handleConversationClick = useCallback((conversationId: string) => {
    router.push(`/${conversationId}`)
  }, [router])

  // Auto-select first workspace when workspaces load
  useEffect(() => {
    if (workspaces.length > 0 && !selectedWorkspace) {
      setSelectedWorkspace(workspaces[0])
    }
  }, [workspaces, selectedWorkspace])

  const handleCreateConversation = () => {
    // Navigate to new conversation route with workspace ID
    if (selectedWorkspace) {
      router.push(`/new?workspace=${selectedWorkspace.id}`)
    } else {
      router.push('/new')
    }
  }

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return

    try {
      const workspace = await createWorkspace(newWorkspaceName.trim())
      setNewWorkspaceName("")
      setShowNewWorkspaceDialog(false)
      setSelectedWorkspace(workspace)
      toast({
        title: "Success",
        description: "Workspace created successfully",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create workspace",
        variant: "destructive",
      })
    }
  }

  const handleDeleteConversation = useCallback(async (conversationId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setActiveDropdownId(null)
    
    try {
      // If we're deleting the selected conversation, find the next one to select
      let nextConversation: Conversation | null = null
      if (selectedConversationId === conversationId && selectedWorkspace) {
        const currentIndex = conversations.findIndex(c => c.id === conversationId)
        if (currentIndex !== -1) {
          // Try to select the conversation after the deleted one, or before if it's the last one
          if (currentIndex < conversations.length - 1) {
            nextConversation = conversations[currentIndex + 1]
          } else if (currentIndex > 0) {
            nextConversation = conversations[currentIndex - 1]
          }
          // If there's a next conversation, navigate to it
          if (nextConversation) {
            router.push(`/${nextConversation.id}`)
          } else {
            // No conversations left, go to home page
            router.push('/')
          }
        }
      }
      
      await deleteConversation(conversationId)
      toast({
        title: "Success",
        description: "Conversation deleted successfully",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete conversation",
        variant: "destructive",
      })
    }
  }, [selectedConversationId, selectedWorkspace, conversations, router, deleteConversation, toast])

  const handleRenameConversation = useCallback(async (conversationId: string, newTitle: string) => {
    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      })

      if (!response.ok) {
        throw new Error('Failed to rename conversation')
      }

      setRenamingConversation(null)
      toast({
        title: "Success",
        description: "Conversation renamed successfully",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to rename conversation",
        variant: "destructive",
      })
    }
  }, [toast])

  const handleStartRename = useCallback((conversation: Conversation) => {
    setActiveDropdownId(null)
    setRenamingConversation({ id: conversation.id, title: conversation.title || '' })
  }, [])

  const handleDropdownToggle = useCallback((conversationId: string, isOpen: boolean) => {
    setActiveDropdownId(isOpen ? conversationId : null)
  }, [])

  // Track prefetched conversations to avoid duplicate fetches
  const prefetchedConversations = useRef<Set<string>>(new Set())
  const hoverTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map())
  
  const handleConversationHover = useCallback(async (conversationId: string) => {
    // Clear any existing timeout for this conversation
    const existingTimeout = hoverTimeouts.current.get(conversationId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }
    
    // Set a new timeout to prefetch after 150ms of stable hover
    const timeout = setTimeout(async () => {
      // Always prefetch the route (this is cheap and Next.js handles deduplication)
      router.prefetch(`/${conversationId}`)
      
      // Check if we've already prefetched this conversation
      if (prefetchedConversations.current.has(conversationId)) {
        console.log('💾 Already prefetched:', conversationId, '- skipping fetch')
        return
      }
      
      console.log('🚀 Prefetching conversation (first time):', conversationId)
      
      const swrKey = `/api/conversations/${conversationId}?include_messages=true`
      
      try {
        await mutate(swrKey, async () => {
          const response = await fetch(swrKey)
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }
          const data = await response.json()
          console.log('✅ SWR cached conversation data:', data?.messages?.length || 0, 'messages')
          return data
        }, { revalidate: false })
        
        // Mark as prefetched
        prefetchedConversations.current.add(conversationId)
      } catch (error) {
        console.log('⚠️ SWR prefetch failed (this is okay):', error)
      }
      
      // Clean up the timeout reference
      hoverTimeouts.current.delete(conversationId)
    }, 150)
    
    hoverTimeouts.current.set(conversationId, timeout)
  }, [router])

  // Memoize date formatting to avoid recalculating on every render
  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString)
    
    // Handle invalid dates
    if (isNaN(date.getTime())) {
      return 'Recently'
    }
    
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    // Handle negative differences (future dates or clock skew)
    if (diffDays < 0) return 'Today'
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
  }, [])

  // Memoize conversations with pre-calculated formatted dates
  const conversationsWithFormattedDates = useMemo(() => {
    return conversations.map(conversation => ({
      ...conversation,
      formattedDate: formatDate(conversation.updated_at)
    }))
  }, [conversations, formatDate])

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to sign out",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="w-60 h-full flex flex-col bg-background border-r overflow-hidden">
      {/* Workspace Selector */}
      <div className="p-3 border-b">
        {workspacesLoading ? (
          <div className="flex items-center justify-center p-2">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <div className="flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  <span className="truncate">
                    {selectedWorkspace?.name || "Select Workspace"}
                  </span>
                </div>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              {workspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  onClick={() => {
                    // Only navigate if switching to a different workspace
                    if (selectedWorkspace?.id !== workspace.id) {
                      setSelectedWorkspace(workspace)
                      // Navigate to chat home when switching workspaces to show empty chat screen
                      router.push('/chat')
                    }
                  }}
                  className={selectedWorkspace?.id === workspace.id ? "bg-accent" : ""}
                >
                  <Building className="mr-2 h-4 w-4" />
                  <span>{workspace.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => setShowNewWorkspaceDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                <span>New Workspace</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* New Conversation Button */}
      <div className="p-3">
        <Button 
          variant="outline" 
          className="w-full justify-start gap-2"
          onClick={handleCreateConversation}
          disabled={!selectedWorkspace}
        >
          <Plus size={16} />
          <span>New conversation</span>
        </Button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="w-full">
          {conversationsLoading ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No conversations yet. Create your first conversation!
            </div>
          ) : (
            conversationsWithFormattedDates.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isSelected={selectedConversationId === conversation.id}
                onConversationClick={handleConversationClick}
                onDeleteConversation={handleDeleteConversation}
                onStartRename={handleStartRename}
                formattedDate={conversation.formattedDate}
                isDropdownActive={activeDropdownId === conversation.id}
                onDropdownToggle={handleDropdownToggle}
                onConversationHover={handleConversationHover}
              />
            ))
          )}
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="mt-auto p-2 space-y-1 border-t">
        <ThemeToggle />
        <Button variant="ghost" className="w-full justify-start gap-2 text-sm font-normal">
          <Avatar className="h-4 w-4">
            {user?.user_metadata?.avatar_url ? (
              <img src={user.user_metadata.avatar_url} alt="User" />
            ) : (
              <div className="bg-primary text-primary-foreground flex items-center justify-center text-xs">
                {user?.email?.charAt(0).toUpperCase()}
              </div>
            )}
          </Avatar>
          <span className="truncate">{user?.email}</span>
        </Button>
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2 text-sm font-normal"
          onClick={handleSignOut}
        >
          <LogOut size={16} />
          <span>Sign Out</span>
        </Button>
        <div className="px-2 py-1 text-xs text-muted-foreground">
          Bud is planted with 💚 in San Francisco
        </div>
      </div>

      {/* New Workspace Dialog */}
      <Dialog open={showNewWorkspaceDialog} onOpenChange={setShowNewWorkspaceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Input
                placeholder="Workspace name"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkspace()}
              />
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={handleCreateWorkspace}
                disabled={!newWorkspaceName.trim()}
                className="flex-1"
              >
                Create
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowNewWorkspaceDialog(false)}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename Conversation Dialog */}
      <Dialog open={!!renamingConversation} onOpenChange={(open) => !open && setRenamingConversation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Conversation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Input
                placeholder="Conversation name"
                value={renamingConversation?.title || ''}
                onChange={(e) => setRenamingConversation(prev => prev ? { ...prev, title: e.target.value } : null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renamingConversation) {
                    handleRenameConversation(renamingConversation.id, renamingConversation.title)
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={() => renamingConversation && handleRenameConversation(renamingConversation.id, renamingConversation.title)}
                disabled={!renamingConversation?.title.trim()}
                className="flex-1"
              >
                Rename
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setRenamingConversation(null)}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default memo(ChatSidebar)
