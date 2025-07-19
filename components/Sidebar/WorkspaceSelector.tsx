'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkspaces, useSetWorkspaces } from '@/state/workspaceStore';
import { useSelectedWorkspace, useSetSelectedWorkspace, useConversations, useEventChatStore } from '@/state/eventChatStore';
import { Building2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { NewWorkspaceModal } from './NewWorkspaceModal';

export function WorkspaceSelector() {
  const router = useRouter();
  const workspaces = useWorkspaces();
  const setWorkspaces = useSetWorkspaces();
  const selectedWorkspaceId = useSelectedWorkspace();
  const setSelectedWorkspace = useSetSelectedWorkspace();
  const conversationsRecord = useConversations();
  const [showNewWorkspaceModal, setShowNewWorkspaceModal] = useState(false);

  const selectedWorkspace = workspaces.find(w => w.id === selectedWorkspaceId);

  const handleWorkspaceChange = (workspaceId: string) => {
    // Handle "new-workspace" special case
    if (workspaceId === 'new-workspace') {
      setShowNewWorkspaceModal(true);
      return;
    }
    
    setSelectedWorkspace(workspaceId);
    // Save to localStorage for persistence
    localStorage.setItem('lastSelectedWorkspaceId', workspaceId);
    
    // Get workspace conversations directly from store
    const storeState = useEventChatStore.getState();
    const workspaceConversationIds = storeState.workspaceConversations[workspaceId];
    
    if (workspaceConversationIds && workspaceConversationIds.length > 0) {
      // Find the most recent conversation by created_at
      const workspaceConversations = workspaceConversationIds
        .map(id => storeState.conversations[id])
        .filter(Boolean)
        .sort((a, b) => new Date(b.meta.created_at).getTime() - new Date(a.meta.created_at).getTime());
      
      if (workspaceConversations.length > 0) {
        const mostRecentConversation = workspaceConversations[0];
        router.push(`/chat/${mostRecentConversation.id}`);
        return;
      }
    }
    
    // Fall back to home route to select a bud if no conversations exist
    router.push('/');
  };

  const handleCreateWorkspace = async (name: string) => {
    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
        }),
      });

      if (response.ok) {
        const newWorkspace = await response.json();
        
        // Update the workspaces in the store
        const updatedWorkspaces = [...workspaces, newWorkspace];
        setWorkspaces(updatedWorkspaces);
        
        // Switch to the new workspace
        setSelectedWorkspace(newWorkspace.id);
        localStorage.setItem('lastSelectedWorkspaceId', newWorkspace.id);
        
        // Navigate to home route to select a bud in the new workspace
        router.push('/');
      } else {
        console.error('Failed to create workspace');
        throw new Error('Failed to create workspace');
      }
    } catch (error) {
      console.error('Error creating workspace:', error);
      throw error;
    }
  };

  if (workspaces.length === 0) {
    return (
      <>
        <div className="text-center p-4">
          <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground mb-2">No workspaces</p>
          <Button onClick={() => setShowNewWorkspaceModal(true)} size="sm">
            <Plus className="h-3 w-3 mr-1" />
            Create Workspace
          </Button>
        </div>
        <NewWorkspaceModal
          open={showNewWorkspaceModal}
          onOpenChange={setShowNewWorkspaceModal}
          onCreateWorkspace={handleCreateWorkspace}
        />
      </>
    );
  }

  return (
    <>
      <Select
        value={selectedWorkspaceId || undefined}
        onValueChange={handleWorkspaceChange}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select workspace">
            {selectedWorkspace && (
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                <span>{selectedWorkspace.name}</span>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                <span>{workspace.name}</span>
              </div>
            </SelectItem>
          ))}
          <SelectItem value="new-workspace">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              <span>New Workspace</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>

      <NewWorkspaceModal
        open={showNewWorkspaceModal}
        onOpenChange={setShowNewWorkspaceModal}
        onCreateWorkspace={handleCreateWorkspace}
      />
    </>
  );
}