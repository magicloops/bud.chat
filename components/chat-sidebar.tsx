"use client"

import { useState, useEffect } from "react"
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

interface ChatSidebarProps {
  selectedConversationId?: string | null
  onConversationSelect: (conversation: Conversation, workspace: Workspace) => void
  onConversationUpdate?: (conversation: Conversation) => void
  onConversationChange?: (conversationId: string, workspaceId: string, title?: string, messages?: any[]) => void
}

export default function ChatSidebar({ selectedConversationId, onConversationSelect, onConversationUpdate, onConversationChange }: ChatSidebarProps) {
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
  const [newWorkspaceName, setNewWorkspaceName] = useState("")
  const [showNewWorkspaceDialog, setShowNewWorkspaceDialog] = useState(false)
  
  const { user, signOut } = useAuth()
  const { toast } = useToast()
  
  const { workspaces, loading: workspacesLoading, createWorkspace } = useWorkspaces()
  const { conversations, loading: conversationsLoading, createConversation, deleteConversation } = useConversations(
    selectedWorkspace?.id || null,
    onConversationUpdate
  )

  // Auto-select first workspace when workspaces load
  useEffect(() => {
    if (workspaces.length > 0 && !selectedWorkspace) {
      setSelectedWorkspace(workspaces[0])
    }
  }, [workspaces, selectedWorkspace])

  const handleCreateConversation = async () => {
    if (!selectedWorkspace) {
      toast({
        title: "Error",
        description: "Please select a workspace first",
        variant: "destructive",
      })
      return
    }

    try {
      const conversation = await createConversation("New Chat")
      // The greeting message is now saved to the database, so just select the conversation
      onConversationSelect(conversation, selectedWorkspace)
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create conversation",
        variant: "destructive",
      })
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

  const handleDeleteConversation = async (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    
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
          // If there's a next conversation, select it immediately
          if (nextConversation) {
            onConversationSelect(nextConversation, selectedWorkspace)
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
  }

  const formatDate = (dateString: string) => {
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
  }

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
                  onClick={() => setSelectedWorkspace(workspace)}
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
            conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`group mb-1 mx-2 rounded-md hover:bg-accent ${
                  selectedConversationId === conversation.id ? "bg-accent" : ""
                }`}
              >
                <div className="flex items-center max-w-full">
                  <button
                    className="flex items-center gap-2 text-sm font-normal py-2 px-3 text-left flex-1 min-w-0 rounded-md"
                    onClick={() => selectedWorkspace && onConversationSelect(conversation, selectedWorkspace)}
                  >
                    <MessageCircle className="h-4 w-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{conversation.title || "Untitled"}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(conversation.updated_at)}
                      </div>
                    </div>
                  </button>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mr-1"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>
                      <Edit className="mr-2 h-4 w-4" />
                      <span>Rename</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={(e) => handleDeleteConversation(conversation.id, e)}
                      className="text-red-600"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                </div>
              </div>
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
    </div>
  )
}