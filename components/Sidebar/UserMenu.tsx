'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useThemeToggle } from '@/hooks/use-theme-toggle';
import { 
  User, 
  Settings, 
  LogOut, 
  ChevronUp,
  Moon,
  Sun,
  Palette,
  Cog,
  Wrench
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useConversation, useSelectedWorkspace } from '@/state/eventChatStore';
import { useBud } from '@/state/budStore';

export function UserMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(false);
  const { toggleTheme, isDarkMode, mounted } = useThemeToggle();
  
  // Extract conversation ID from pathname and get conversation/bud data
  const conversationId = pathname?.match(/\/chat\/([^\/]+)/)?.[1];
  const conversation = useConversation(conversationId || '');
  const bud = useBud(conversation?.meta.source_bud_id || '');
  
  // Check if there's a custom theme active (from bud default)
  const budConfig = bud?.default_json as Record<string, unknown> | undefined;
  const hasCustomTheme = budConfig && typeof budConfig === 'object' && 'customTheme' in budConfig;

  const handleSignOut = async () => {
    try {
      setIsLoading(true);
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push('/auth');
    } catch (error) {
      console.error('Error signing out:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSettings = () => {
    // Trigger settings panel toggle
    const settingsPanelOpen = localStorage.getItem('settingsPanelOpen') === 'true';
    localStorage.setItem('settingsPanelOpen', String(!settingsPanelOpen));
    // Trigger a custom event to notify the layout
    window.dispatchEvent(new CustomEvent('toggleSettingsPanel', { detail: { open: !settingsPanelOpen } }));
  };

  const handleProfile = () => {
    // TODO: Implement profile
    console.log('Open profile');
  };

  const selectedWorkspaceId = useSelectedWorkspace();
  
  const handleManageBuds = () => {
    if (selectedWorkspaceId) {
      router.push(`/workspace/${selectedWorkspaceId}/buds`);
    }
  };

  const handleWorkspaceSettings = () => {
    if (selectedWorkspaceId) {
      router.push(`/workspace/${selectedWorkspaceId}/settings`);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
              <User className="h-3 w-3 text-primary-foreground" />
            </div>
            <span className="text-sm">User</span>
          </div>
          <ChevronUp className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={handleProfile}>
          <User className="h-4 w-4 mr-2" />
            Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSettings}>
          <Settings className="h-4 w-4 mr-2" />
            Settings
        </DropdownMenuItem>
        {selectedWorkspaceId && (
          <>
            <DropdownMenuItem onClick={handleManageBuds}>
              <Cog className="h-4 w-4 mr-2" />
              Manage Buds
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleWorkspaceSettings}>
              <Wrench className="h-4 w-4 mr-2" />
              Workspace Settings
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={hasCustomTheme ? undefined : toggleTheme} className={hasCustomTheme ? 'opacity-50 cursor-not-allowed' : ''}>
          {hasCustomTheme ? (
            <Palette className="h-4 w-4 mr-2" />
          ) : mounted ? (
            isDarkMode ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />
          ) : (
            <Moon className="h-4 w-4 mr-2" />
          )}
          {hasCustomTheme ? 'Custom Theme' : mounted ? (isDarkMode ? 'Light mode' : 'Dark mode') : 'Theme'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} disabled={isLoading}>
          <LogOut className="h-4 w-4 mr-2" />
          {isLoading ? 'Signing out...' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}