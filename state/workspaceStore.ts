import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { useMemo } from 'react'
import { 
  Workspace, 
  WorkspaceMember, 
  Conversation, 
  Bud, 
  WorkspaceId, 
  ConversationId, 
  BudId,
  BudConfig
} from '@/lib/types'

interface WorkspaceStore {
  // State
  workspaces: Record<WorkspaceId, Workspace>
  members: Record<WorkspaceId, WorkspaceMember[]>
  conversations: Record<WorkspaceId, Conversation[]>
  buds: Record<WorkspaceId, Bud[]>
  
  // Loading states
  loading: {
    workspaces: boolean
    conversations: Record<WorkspaceId, boolean>
    buds: Record<WorkspaceId, boolean>
  }
  
  
  // Actions - Workspace Management
  setWorkspaces: (workspaces: Workspace[]) => void
  addWorkspace: (workspace: Workspace) => void
  updateWorkspace: (id: WorkspaceId, updates: Partial<Workspace>) => void
  removeWorkspace: (id: WorkspaceId) => void
  
  // Actions - Members Management
  setWorkspaceMembers: (workspaceId: WorkspaceId, members: WorkspaceMember[]) => void
  addWorkspaceMember: (workspaceId: WorkspaceId, member: WorkspaceMember) => void
  removeWorkspaceMember: (workspaceId: WorkspaceId, userId: string) => void
  updateMemberRole: (workspaceId: WorkspaceId, userId: string, role: string) => void
  
  // Actions - Conversations Management
  setConversations: (workspaceId: WorkspaceId, conversations: Conversation[]) => void
  addConversation: (conversation: Conversation) => void
  updateConversation: (id: ConversationId, updates: Partial<Conversation>) => void
  removeConversation: (id: ConversationId) => void
  
  // Actions - Buds Management
  setBuds: (workspaceId: WorkspaceId, buds: Bud[]) => void
  addBud: (bud: Bud) => void
  updateBud: (id: BudId, updates: Partial<Bud>) => void
  removeBud: (id: BudId) => void
  
  // Actions - Loading States
  setWorkspacesLoading: (loading: boolean) => void
  setConversationsLoading: (workspaceId: WorkspaceId, loading: boolean) => void
  setBudsLoading: (workspaceId: WorkspaceId, loading: boolean) => void
  
  // Actions - Optimistic Operations
  createOptimisticConversation: (workspaceId: WorkspaceId, budId?: BudId) => Conversation
  
  // Actions - Persistence
  hydrate: (data: Partial<Pick<WorkspaceStore, 'workspaces' | 'conversations' | 'buds'>>) => void
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  subscribeWithSelector(
    persist(
      immer((set, get) => ({
        // Initial state
        workspaces: {},
        members: {},
        conversations: {},
        buds: {},
        loading: {
          workspaces: false,
          conversations: {},
          buds: {},
        },
        
        // Workspace Management Actions
        setWorkspaces: (workspaces) => set((state) => {
          state.workspaces = Object.fromEntries(workspaces.map(w => [w.id, w]))
        }),
        
        addWorkspace: (workspace) => set((state) => {
          state.workspaces[workspace.id] = workspace
        }),
        
        updateWorkspace: (id, updates) => set((state) => {
          if (state.workspaces[id]) {
            Object.assign(state.workspaces[id], updates)
          }
        }),
        
        removeWorkspace: (id) => set((state) => {
          delete state.workspaces[id]
          delete state.members[id]
          delete state.conversations[id]
          delete state.buds[id]
          delete state.loading.conversations[id]
          delete state.loading.buds[id]
        }),
        
        // Members Management Actions
        setWorkspaceMembers: (workspaceId, members) => set((state) => {
          state.members[workspaceId] = members
        }),
        
        addWorkspaceMember: (workspaceId, member) => set((state) => {
          if (!state.members[workspaceId]) {
            state.members[workspaceId] = []
          }
          const existing = state.members[workspaceId].findIndex(m => m.user_id === member.user_id)
          if (existing >= 0) {
            state.members[workspaceId][existing] = member
          } else {
            state.members[workspaceId].push(member)
          }
        }),
        
        removeWorkspaceMember: (workspaceId, userId) => set((state) => {
          if (state.members[workspaceId]) {
            state.members[workspaceId] = state.members[workspaceId].filter(m => m.user_id !== userId)
          }
        }),
        
        updateMemberRole: (workspaceId, userId, role) => set((state) => {
          const members = state.members[workspaceId]
          if (members) {
            const member = members.find(m => m.user_id === userId)
            if (member) {
              member.role = role
            }
          }
        }),
        
        // Conversations Management Actions
        setConversations: (workspaceId, conversations) => set((state) => {
          state.conversations[workspaceId] = conversations.sort((a, b) => 
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
        }),
        
        addConversation: (conversation) => set((state) => {
          const workspaceId = conversation.workspace_id
          if (!state.conversations[workspaceId]) {
            state.conversations[workspaceId] = []
          }
          
          // Add to beginning (most recent first)
          state.conversations[workspaceId].unshift(conversation)
        }),
        
        updateConversation: (id, updates) => set((state) => {
          // Find conversation across all workspaces
          for (const workspaceId in state.conversations) {
            const conversations = state.conversations[workspaceId]
            const index = conversations.findIndex(c => c.id === id)
            if (index >= 0) {
              Object.assign(conversations[index], updates)
              break
            }
          }
        }),
        
        removeConversation: (id) => set((state) => {
          // Remove conversation from all workspaces
          for (const workspaceId in state.conversations) {
            state.conversations[workspaceId] = state.conversations[workspaceId].filter(c => c.id !== id)
          }
        }),
        
        // Buds Management Actions
        setBuds: (workspaceId, buds) => set((state) => {
          state.buds[workspaceId] = buds.sort((a, b) => a.name.localeCompare(b.name))
        }),
        
        addBud: (bud) => set((state) => {
          const workspaceId = bud.workspace_id
          if (!workspaceId) return // Personal buds not supported yet
          
          if (!state.buds[workspaceId]) {
            state.buds[workspaceId] = []
          }
          
          state.buds[workspaceId].push(bud)
          state.buds[workspaceId].sort((a, b) => a.name.localeCompare(b.name))
        }),
        
        updateBud: (id, updates) => set((state) => {
          // Find bud across all workspaces
          for (const workspaceId in state.buds) {
            const buds = state.buds[workspaceId]
            const index = buds.findIndex(b => b.id === id)
            if (index >= 0) {
              Object.assign(buds[index], updates)
              // Re-sort if name changed
              if (updates.name) {
                buds.sort((a, b) => a.name.localeCompare(b.name))
              }
              break
            }
          }
        }),
        
        removeBud: (id) => set((state) => {
          // Remove bud from all workspaces
          for (const workspaceId in state.buds) {
            state.buds[workspaceId] = state.buds[workspaceId].filter(b => b.id !== id)
          }
        }),
        
        // Loading States Actions
        setWorkspacesLoading: (loading) => set((state) => {
          state.loading.workspaces = loading
        }),
        
        setConversationsLoading: (workspaceId, loading) => set((state) => {
          state.loading.conversations[workspaceId] = loading
        }),
        
        setBudsLoading: (workspaceId, loading) => set((state) => {
          state.loading.buds[workspaceId] = loading
        }),
        
        // Optimistic Operations
        createOptimisticConversation: (workspaceId, budId) => {
          const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          const conversation: Conversation = {
            id: tempId,
            workspace_id: workspaceId,
            root_msg_id: null,
            bud_id: budId || null,
            created_at: new Date().toISOString(),
          }
          
          set((state) => {
            if (!state.conversations[workspaceId]) {
              state.conversations[workspaceId] = []
            }
            state.conversations[workspaceId].unshift(conversation)
          })
          
          return conversation
        },
        
        // Persistence Actions
        hydrate: (data) => set((state) => {
          if (data.workspaces) {
            Object.assign(state.workspaces, data.workspaces)
          }
          if (data.conversations) {
            Object.assign(state.conversations, data.conversations)
          }
          if (data.buds) {
            Object.assign(state.buds, data.buds)
          }
        }),
      })),
      {
        name: 'workspace-store',
        partialize: (state) => ({
          workspaces: state.workspaces,
          // Persist conversations and buds for offline access
          conversations: state.conversations,
          buds: state.buds,
          // Don't persist loading states or members (they change frequently)
        }),
      }
    )
  )
)

// Selectors for performance
export const useWorkspace = (workspaceId: WorkspaceId) =>
  useWorkspaceStore((state) => state.workspaces[workspaceId])

export const useWorkspaces = () => {
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  return useMemo(() => Object.values(workspaces), [workspaces])
}

export const useWorkspaceConversations = (workspaceId: WorkspaceId) => {
  const conversations = useWorkspaceStore((state) => state.conversations[workspaceId])
  return useMemo(() => conversations || [], [conversations])
}

export const useWorkspaceBuds = (workspaceId: WorkspaceId) => {
  const buds = useWorkspaceStore((state) => state.buds[workspaceId])
  return useMemo(() => buds || [], [buds])
}

export const useWorkspaceLoading = (workspaceId: WorkspaceId) =>
  useWorkspaceStore((state) => 
    state.loading.workspaces || 
    state.loading.conversations[workspaceId] || 
    state.loading.buds[workspaceId] || 
    false
  )

// Individual action hooks - the proper Zustand way
export const useSetWorkspaces = () => useWorkspaceStore((state) => state.setWorkspaces)
export const useSetConversations = () => useWorkspaceStore((state) => state.setConversations)
export const useRemoveConversation = () => useWorkspaceStore((state) => state.removeConversation)
export const useSetWorkspacesLoading = () => useWorkspaceStore((state) => state.setWorkspacesLoading)
export const useSetConversationsLoading = () => useWorkspaceStore((state) => state.setConversationsLoading)