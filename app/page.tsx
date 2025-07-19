'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-provider';
import { AuthModal } from '@/components/auth/auth-modal';
import { Sidebar } from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { MessageSquare, PanelLeft } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { useSelectedWorkspace } from '@/state/eventChatStore';
import { BudSelectionGrid } from '@/components/BudSelectionGrid';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const selectedWorkspace = useSelectedWorkspace();
  
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Load sidebar state from localStorage on mount
  useEffect(() => {
    const savedSidebarOpen = localStorage.getItem('sidebarOpen');
    if (savedSidebarOpen !== null) {
      setSidebarOpen(savedSidebarOpen === 'true');
    }
  }, []);

  const handleSidebarToggle = (open: boolean) => {
    setSidebarOpen(open);
    localStorage.setItem('sidebarOpen', String(open));
  };


  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthModal />;
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Left Sidebar */}
      <div className={`
        transition-[width] ease-out h-full
        ${sidebarOpen ? 'w-60' : 'w-0'}
        overflow-hidden
      `}>
        <div className={`
          transition-opacity ease-out h-full
          ${sidebarOpen ? 'opacity-100' : 'opacity-0'}
          w-60
        `}>
          <Sidebar className="h-full" onClose={() => handleSidebarToggle(false)} />
        </div>
      </div>

      {/* Left Sidebar Toggle Button - Always Visible */}
      {!sidebarOpen && (
        <div className="absolute top-4 left-4 z-50">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleSidebarToggle(true)}
            className="h-8 w-8 bg-background/80 backdrop-blur-sm border hover:bg-accent"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Main Welcome Area */}
      <div className="flex-1 flex flex-col border-l min-w-0">
        {/* Main Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {selectedWorkspace ? (
            // Show Bud selection grid when workspace is selected
            <BudSelectionGrid workspaceId={selectedWorkspace} />
          ) : (
            // Show welcome content when no workspace is selected
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md mx-auto p-8">
                <MessageSquare className="h-16 w-16 mx-auto mb-6 text-muted-foreground" />
                <h1 className="text-2xl font-semibold mb-4">Welcome to bud.chat</h1>
                <p className="text-muted-foreground mb-8">
                  Create AI assistants (Buds) with custom personalities and start conversations. 
                  Your conversations are automatically saved and organized by workspace.
                </p>
                
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground/80">
                    <p>👈 Select a workspace from the sidebar to get started</p>
                    <p className="mt-2">💡 Each workspace can have multiple custom Buds</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
