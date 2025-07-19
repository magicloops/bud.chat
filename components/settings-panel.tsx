'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ChevronDown, ChevronRight, HelpCircle, Palette, PanelRightClose, Save, Wrench } from 'lucide-react';
import { useModel } from '@/contexts/model-context';
import { useToast } from '@/hooks/use-toast';
import { BudConfig } from '@/lib/types';
import { useConversation, useSetConversation } from '@/state/eventChatStore';
import { useBud, useUpdateBud } from '@/state/budStore';
import { EmojiPicker } from '@/components/EmojiPicker';
import { getModelsForUI, getDefaultModel } from '@/lib/modelMapping';
import { MCPConfigurationPanel } from '@/components/MCP/MCPConfigurationPanel';
import type { MCPConfiguration } from '@/components/MCP/MCPConfigurationPanel';

interface ConversationOverrides {
  name?: string
  assistantName?: string
  model?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  avatar?: string
  mcpConfig?: MCPConfiguration
}

interface SettingsPanelProps {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const pathname = usePathname();
  
  // Determine panel mode based on route
  const isPreConversation = pathname?.includes('/new') || false;
  const panelMode = isPreConversation ? 'bud' : 'chat';
  
  // Extract conversation ID from pathname (/chat/[conversationId])
  const conversationId = pathname?.match(/\/chat\/([^\/]+)/)?.[1];
  
  // Get conversation and bud data from stores
  const conversation = useConversation(conversationId || '');
  
  // For pre-conversation mode, get bud from URL params
  // For active conversation mode, get bud from conversation's source_bud_id
  const urlBudId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('bud') : null;
  const targetBudId = isPreConversation ? urlBudId : conversation?.meta.source_bud_id;
  const bud = useBud(targetBudId || '');
  
  const setConversation = useSetConversation();
  const updateBud = useUpdateBud();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [showThemeDialog, setShowThemeDialog] = useState(false);
  const [themePrompt, setThemePrompt] = useState('');
  const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const { selectedModel, setSelectedModel } = useModel();
  const { toast } = useToast();

  // Get bud config and conversation overrides  
  const budConfig = bud?.default_json as BudConfig | undefined;
  const conversationOverrides = conversation?.meta.model_config_overrides as ConversationOverrides | undefined;
  const mcpOverrides = conversation?.meta.mcp_config_overrides as MCPConfiguration | undefined;

  // Form state with default values from bud config and overrides from conversation
  const [chatName, setChatName] = useState('');
  const [assistantName, setAssistantName] = useState('');
  const [aiModel, setAiModel] = useState(selectedModel || getDefaultModel()); // Initialize with selectedModel or default
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(1);
  const [maxTokens, setMaxTokens] = useState<number | undefined>(undefined);
  const [avatar, setAvatar] = useState('');
  const [currentTheme, setCurrentTheme] = useState<{name: string, cssVariables: Record<string, string>} | undefined>(undefined);
  const [mcpConfig, setMcpConfig] = useState<MCPConfiguration>({});

  // Update form values when props change
  useEffect(() => {
    // Only update if we have meaningful data to work with
    if (panelMode === 'chat' && !conversation) {
      return; // Don't update until conversation is loaded
    }
    if (panelMode === 'bud' && !bud) {
      return; // Don't update until bud is loaded
    }

    // Debug logging
    console.log('🔧 Settings Panel - Data loaded:', {
      panelMode,
      conversation: conversation?.meta,
      bud: bud?.default_json,
      conversationOverrides,
      mcpOverrides,
      budConfig: budConfig ? { name: budConfig.name, avatar: budConfig.avatar, model: budConfig.model, mcpConfig: budConfig.mcpConfig } : null
    });
    
    // Get available models to validate
    const availableModels = getModelsForUI().map(m => m.value);
    
    if (panelMode === 'bud') {
      // Bud mode: Use bud config values directly
      const newChatName = budConfig?.name || '';
      const newAssistantName = budConfig?.name || '';
      const budModel = budConfig?.model || getDefaultModel();
      
      // Validate model exists in available options
      const validModel = availableModels.includes(budModel) ? budModel : getDefaultModel();
      console.log('🔧 Settings Panel - Bud mode model:', { budConfigModel: budConfig?.model, finalModel: budModel, validModel, availableModels: availableModels.slice(0, 3) });
      
      setChatName(newChatName);
      setAssistantName(newAssistantName);
      setAiModel(validModel);
      setSystemPrompt(budConfig?.systemPrompt || '');
      setTemperature(budConfig?.temperature || 1);
      setMaxTokens(budConfig?.maxTokens || undefined);
      setAvatar(budConfig?.avatar || '');
      setMcpConfig(budConfig?.mcpConfig || {});
    } else {
      // Chat mode: Use conversation overrides with bud fallbacks
      const newChatName = conversation?.meta.title || '';
      const newAssistantName = conversationOverrides?.assistantName || conversation?.meta.assistant_name || budConfig?.name || '';
      const chatModel = conversationOverrides?.model || budConfig?.model || getDefaultModel();
      
      // Validate model exists in available options
      const validModel = availableModels.includes(chatModel) ? chatModel : getDefaultModel();
      console.log('🔧 Settings Panel - Chat mode model:', { conversationModel: conversationOverrides?.model, budConfigModel: budConfig?.model, finalModel: chatModel, validModel, availableModels: availableModels.slice(0, 3) });
      
      setChatName(newChatName);
      setAssistantName(newAssistantName);
      setAiModel(validModel);
      setSystemPrompt(conversationOverrides?.systemPrompt || budConfig?.systemPrompt || '');
      setTemperature(conversationOverrides?.temperature || budConfig?.temperature || 1);
      setMaxTokens(conversationOverrides?.maxTokens || budConfig?.maxTokens || undefined);
      setAvatar(conversationOverrides?.avatar || conversation?.meta.assistant_avatar || budConfig?.avatar || '');
      setMcpConfig(mcpOverrides || budConfig?.mcpConfig || {});
    }
    
    setCurrentTheme(budConfig?.customTheme);
    setHasUnsavedChanges(false);
  }, [
    panelMode, 
    conversation?.id, 
    conversation?.meta?.title,
    conversation?.meta?.assistant_name,
    conversation?.meta?.assistant_avatar,
    bud?.id,
    conversationOverrides ? JSON.stringify(conversationOverrides) : 'undefined',
    mcpOverrides ? JSON.stringify(mcpOverrides) : 'undefined',
    budConfig ? JSON.stringify(budConfig) : 'undefined'
  ]);

  // Handle value changes - track for save confirmation in both modes
  const handleFieldChange = (field: string, value: any) => {
    setHasUnsavedChanges(true);
    
    switch (field) {
      case 'name':
        setChatName(value);
        break;
      case 'assistantName':
        setAssistantName(value);
        break;
      case 'model':
        setAiModel(value);
        setSelectedModel(value);
        break;
      case 'systemPrompt':
        setSystemPrompt(value);
        break;
      case 'temperature':
        setTemperature(value);
        break;
      case 'maxTokens':
        setMaxTokens(value);
        break;
      case 'avatar':
        setAvatar(value);
        break;
      case 'mcpConfig':
        setMcpConfig(value);
        break;
    }
  };

  // Stable callback for MCP configuration changes
  const handleMcpConfigChange = useCallback((config: MCPConfiguration) => {
    setMcpConfig(config);
    setHasUnsavedChanges(true);
  }, []);


  const generateTheme = async () => {
    if (!themePrompt.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a theme description',
        variant: 'destructive',
      });
      return;
    }

    setIsGeneratingTheme(true);
    try {
      const response = await fetch('/api/generate-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: themePrompt })
      });

      if (response.ok) {
        const themeData = await response.json();
        
        // Apply the theme to the document
        const root = document.documentElement;
        Object.entries(themeData.cssVariables).forEach(([key, value]) => {
          root.style.setProperty(key, value as string);
        });

        // Set theme for preview (will be saved when user clicks save)
        setCurrentTheme({
          name: themeData.name,
          cssVariables: themeData.cssVariables
        });
        setHasUnsavedChanges(true);

        toast({
          title: 'Theme Generated!',
          description: `Generated ${themeData.name} theme. Click Save to apply it.`,
        });
        
        setShowThemeDialog(false);
        setThemePrompt('');
      } else {
        throw new Error('Failed to generate theme');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to generate theme',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingTheme(false);
    }
  };

  const resetTheme = () => {
    // Reset CSS variables by removing custom styles
    const root = document.documentElement;
    const commonThemeVars = [
      '--background', '--foreground', '--card', '--card-foreground',
      '--popover', '--popover-foreground', '--primary', '--primary-foreground',
      '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
      '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
      '--border', '--input', '--ring'
    ];
    
    commonThemeVars.forEach(varName => {
      root.style.removeProperty(varName);
    });

    // Mark for save confirmation in both modes
    setCurrentTheme(undefined);
    setHasUnsavedChanges(true);
    toast({
      title: 'Theme Reset',
      description: 'Theme removed. Click Save to apply changes.',
    });
  };

  const handleSave = async (saveType: 'chat' | 'bud') => {
    if (panelMode === 'bud') {
      // Bud mode: Save directly to bud
      if (!bud) return;
      
      try {
        const currentConfig = bud.default_json as BudConfig;
        const updatedConfig: BudConfig = {
          ...currentConfig,
          name: assistantName || currentConfig.name || 'Untitled Bud', // Use assistantName for bud name
          model: aiModel || currentConfig.model || 'gpt-4o',
          systemPrompt: systemPrompt || currentConfig.systemPrompt || '',
          temperature: temperature,
          maxTokens: maxTokens,
          avatar: avatar || currentConfig.avatar || '',
          customTheme: currentTheme,
          mcpConfig: mcpConfig
        };
        
        await updateBud(bud.id, { config: updatedConfig });
        
        toast({
          title: 'Saved!',
          description: 'Updated bud settings',
        });
        
        setHasUnsavedChanges(false);
        
      } catch (error) {
        console.error('Error saving bud:', error);
        toast({
          title: 'Error',
          description: 'Failed to save bud settings',
          variant: 'destructive',
        });
      }
      return;
    }
    
    // Chat mode: existing logic
    if (!conversation || !conversationId) return;
    
    try {
      // Prepare conversation overrides
      const currentOverrides: ConversationOverrides = {
        name: chatName !== (conversation?.meta.title || '') ? chatName : undefined,
        assistantName: assistantName !== (budConfig?.name || '') ? assistantName : undefined,
        model: aiModel !== (budConfig?.model || selectedModel) ? aiModel : undefined,
        systemPrompt: systemPrompt !== (budConfig?.systemPrompt || '') ? systemPrompt : undefined,
        temperature: temperature !== (budConfig?.temperature || 1) ? temperature : undefined,
        maxTokens: maxTokens !== (budConfig?.maxTokens || undefined) ? maxTokens : undefined,
        avatar: avatar !== (budConfig?.avatar || '') ? avatar : undefined,
        mcpConfig: JSON.stringify(mcpConfig) !== JSON.stringify(budConfig?.mcpConfig || {}) ? mcpConfig : undefined
      };
      
      // Remove undefined values
      Object.keys(currentOverrides).forEach(key => {
        if (currentOverrides[key as keyof ConversationOverrides] === undefined) {
          delete currentOverrides[key as keyof ConversationOverrides];
        }
      });
      
      // Update conversation in store - use exact form values
      const updatedConversation = {
        ...conversation,
        meta: {
          ...conversation.meta,
          title: chatName || conversation.meta.title,
          assistant_name: assistantName, // Use exact form value
          assistant_avatar: avatar, // Use exact form value
          model_config_overrides: Object.keys(currentOverrides).length > 0 ? currentOverrides : undefined
        }
      };
      
      setConversation(conversationId, updatedConversation);
      
      // Save conversation overrides to server
      try {
        await fetch(`/api/conversations/${conversationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            title: chatName || null,
            assistant_name: assistantName, // Use exact form value
            assistant_avatar: avatar, // Use exact form value
            model_config_overrides: Object.keys(currentOverrides).length > 0 ? currentOverrides : null,
            mcp_config_overrides: Object.keys(mcpConfig).length > 0 ? mcpConfig : null 
          })
        });
      } catch (error) {
        console.error('Error saving conversation overrides:', error);
      }
      
      // If saving to bud as well, update the bud
      if (saveType === 'bud' && bud) {
        const updatedBudConfig: BudConfig = {
          ...budConfig!,
          name: assistantName || budConfig?.name || 'Untitled Bud',
          model: aiModel || budConfig?.model || selectedModel,
          systemPrompt: systemPrompt || budConfig?.systemPrompt || '',
          temperature: temperature,
          maxTokens: maxTokens,
          avatar: avatar || budConfig?.avatar || '',
          customTheme: currentTheme,
          mcpConfig: mcpConfig
        };
        
        await updateBud(bud.id, { config: updatedBudConfig });
        
        // Set conversation fields to match the updated bud values
        const updatedConversation = {
          ...conversation,
          meta: {
            ...conversation.meta,
            assistant_name: assistantName, // Set to the new bud name
            assistant_avatar: avatar, // Set to the new bud avatar
            model_config_overrides: undefined // Clear model overrides since they're now in the bud
          }
        };
        setConversation(conversationId, updatedConversation);
        
        // Update conversation on server to match bud values
        try {
          await fetch(`/api/conversations/${conversationId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              assistant_name: assistantName, // Set to bud name
              assistant_avatar: avatar, // Set to bud avatar
              model_config_overrides: null, // Clear model overrides
              mcp_config_overrides: null // Clear MCP overrides since they're now in the bud
            })
          });
        } catch (error) {
          console.error('Error updating conversation to match bud:', error);
        }
        
        toast({
          title: 'Saved!',
          description: 'Updated both this chat and the bud',
        });
      } else {
        toast({
          title: 'Saved!',
          description: 'Updated this chat only',
        });
      }
      
      setShowSaveDialog(false);
      setHasUnsavedChanges(false);
      
    } catch (error) {
      console.error('Error saving:', error);
      toast({
        title: 'Error',
        description: 'Failed to save changes',
        variant: 'destructive',
      });
    }
  };

  // Apply current theme based on mode
  useEffect(() => {
    const root = document.documentElement;
    
    if (panelMode === 'bud') {
      // Bud mode: Apply bud theme immediately when bud loads
      if (bud && budConfig?.customTheme) {
        Object.entries(budConfig.customTheme.cssVariables).forEach(([key, value]) => {
          root.style.setProperty(key, value);
        });
      }
    } else if (panelMode === 'chat' && conversationId) {
      // Chat mode: Apply conversation override or bud theme
      const themeToApply = currentTheme || budConfig?.customTheme;
      
      // Clear any existing custom theme variables first
      const commonThemeVars = [
        '--background', '--foreground', '--card', '--card-foreground',
        '--popover', '--popover-foreground', '--primary', '--primary-foreground',
        '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
        '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
        '--border', '--input', '--ring'
      ];
      
      commonThemeVars.forEach(varName => {
        root.style.removeProperty(varName);
      });
      
      // Apply theme if available
      if (themeToApply) {
        Object.entries(themeToApply.cssVariables).forEach(([key, value]) => {
          root.style.setProperty(key, value);
        });
      }
    }
  }, [panelMode, conversationId, currentTheme, budConfig?.customTheme, bud]);

  return (
    <div className="h-full bg-background border-l overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
          <h2 className="font-semibold text-lg">{panelMode === 'bud' ? 'Bud Settings' : 'Chat Settings'}</h2>
        </div>
      </div>

      <ScrollArea className="h-full flex-1 overflow-auto">
        <div className="p-4 space-y-6">
          {panelMode === 'bud' && !bud ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No bud selected</p>
              <p className="text-xs text-muted-foreground mt-1">Select a bud to edit its settings</p>
            </div>
          ) : panelMode === 'chat' && !conversationId ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Start a conversation to access chat settings</p>
            </div>
          ) : panelMode === 'chat' && conversationId && !conversation ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading conversation...</p>
            </div>
          ) : (
            <>
              {/* Settings */}
              <div className="space-y-6">
                {/* Name */}
                <div className="space-y-2">
                  <label htmlFor="settings-name" className="text-sm font-medium">
                    {panelMode === 'bud' ? 'Bud Name' : 'Chat Name'}
                  </label>
                  <Input 
                    id="settings-name" 
                    placeholder={panelMode === 'bud' ? 'Bud name...' : '(Optional) Name this chat...'} 
                    value={chatName}
                    onChange={(e) => {
                      setChatName(e.target.value);
                      handleFieldChange('name', e.target.value);
                    }}
                  />
                </div>

                {/* Assistant Name - only show in chat mode */}
                {panelMode === 'chat' && (
                  <div className="space-y-2">
                    <label htmlFor="assistant-name" className="text-sm font-medium">
                    Assistant Name
                    </label>
                    <Input 
                      id="assistant-name" 
                      placeholder={`Default: ${budConfig?.name || 'Assistant'}`}
                      value={assistantName}
                      onChange={(e) => {
                        setAssistantName(e.target.value);
                        handleFieldChange('assistantName', e.target.value);
                      }}
                    />
                  </div>
                )}

                {/* Icon */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Icon</label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <EmojiPicker 
                        value={avatar}
                        onSelect={(emoji) => {
                          setAvatar(emoji);
                          handleFieldChange('avatar', emoji);
                        }}
                        placeholder="Choose an icon"
                      />
                    </div>
                    {/* Secret theme generator */}
                    <div 
                      className="border rounded-md p-3 w-12 h-10 flex items-center justify-center cursor-pointer hover:bg-accent transition-colors"
                      onClick={() => setShowThemeDialog(true)}
                      title="Secret theme generator"
                    >
                      <Palette className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
                    </div>
                  </div>
                </div>

                {/* AI Model */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <label className="text-sm font-medium">AI Model</label>
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <Select 
                    value={aiModel}
                    onValueChange={(value) => {
                      console.log('Model selection changed:', value); // Debug log
                      handleFieldChange('model', value);
                    }}
                    key={`model-select-${aiModel}`}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {getModelsForUI().map((model) => (
                        <SelectItem key={model.value} value={model.value}>
                          {model.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}: {model.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* AI Goals / Instructions - only show in bud mode */}
                {panelMode === 'bud' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label htmlFor="ai-goals" className="text-sm font-medium">
                      AI Goals / Instructions
                      </label>
                    </div>
                    <Textarea
                      id="ai-goals"
                      placeholder="Your Bud's goal, personality, and info it needs. (Recommended)"
                      className="min-h-[100px]"
                      value={systemPrompt}
                      onChange={(e) => {
                        setSystemPrompt(e.target.value);
                        handleFieldChange('systemPrompt', e.target.value);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* MCP Configuration */}
              {(conversation?.meta.workspace_id || bud?.workspace_id) && (
                <Collapsible open={mcpOpen} onOpenChange={setMcpOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="flex w-full items-center justify-between p-0 h-auto">
                      <div className="flex items-center gap-2">
                        <ChevronRight className={`h-5 w-5 transition-transform ${mcpOpen ? 'rotate-90' : ''}`} />
                        <Wrench className="h-5 w-5" />
                        <span className="text-lg font-semibold">MCP Tools</span>
                      </div>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4 space-y-6">
                    <MCPConfigurationPanel
                      workspaceId={conversation?.meta.workspace_id || bud?.workspace_id || ''}
                      config={mcpConfig}
                      onChange={handleMcpConfigChange}
                      title="" // Remove the title since it's in the collapsible header
                      description={panelMode === 'bud' 
                        ? 'Configure MCP tools for this assistant. These settings will be inherited by new conversations.' 
                        : 'Configure MCP tools for this conversation. Changes will be applied based on your save choice.'
                      }
                    />
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Advanced */}
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="flex w-full items-center justify-between p-0 h-auto">
                    <div className="flex items-center gap-2">
                      <ChevronRight className={`h-5 w-5 transition-transform ${advancedOpen ? 'rotate-90' : ''}`} />
                      <span className="text-lg font-semibold">Advanced</span>
                    </div>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4 space-y-6">
                  {/* Temperature */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <label className="text-sm font-medium">Temperature: {temperature}</label>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="space-y-2">
                      <input 
                        type="range" 
                        min="0" 
                        max="2" 
                        step="0.1" 
                        value={temperature}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value);
                          setTemperature(value);
                          handleFieldChange('temperature', value);
                        }}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>0 (Focused)</span>
                        <span>1 (Balanced)</span>
                        <span>2 (Creative)</span>
                      </div>
                    </div>
                  </div>

                  {/* Max Tokens */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <label htmlFor="max-tokens" className="text-sm font-medium">Max Tokens</label>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <Input 
                      id="max-tokens" 
                      type="number" 
                      placeholder="e.g., 4000" 
                      value={maxTokens || ''}
                      onChange={(e) => {
                        const value = e.target.value ? parseInt(e.target.value) : undefined;
                        setMaxTokens(value);
                        handleFieldChange('maxTokens', value);
                      }}
                      className="w-full"
                    />
                  </div>
              
                  {/* Debug Mode Toggle */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium">Debug Mode</label>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="debug-mode"
                        checked={typeof window !== 'undefined' && localStorage.getItem('debug-mode') === 'true'}
                        onChange={(e) => {
                          if (typeof window !== 'undefined') {
                            localStorage.setItem('debug-mode', e.target.checked.toString());
                            // Trigger a custom event to notify components
                            window.dispatchEvent(new CustomEvent('debug-mode-changed', { detail: e.target.checked }));
                          }
                        }}
                        className="rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <label htmlFor="debug-mode" className="text-sm">
                    Show debug information and internal events
                      </label>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
        </div>
      </ScrollArea>

      {/* Save Button */}
      {hasUnsavedChanges && (
        <div className="p-4 border-t bg-background">
          <Button 
            onClick={() => panelMode === 'bud' ? handleSave('bud') : setShowSaveDialog(true)}
            className="w-full"
          >
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>
      )}

      {/* Save Options Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Changes</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              How would you like to save these changes?
            </p>
            <div className="space-y-2">
              <Button 
                onClick={() => handleSave('chat')}
                variant="outline"
                className="w-full justify-start"
              >
                <div className="text-left">
                  <div className="font-medium">Save to Chat Only</div>
                  <div className="text-xs text-muted-foreground">Changes apply only to this conversation</div>
                </div>
              </Button>
              {bud && (
                <Button 
                  onClick={() => handleSave('bud')}
                  variant="outline"
                  className="w-full justify-start"
                >
                  <div className="text-left">
                    <div className="font-medium">Save to Chat + Update Bud</div>
                    <div className="text-xs text-muted-foreground">Update this chat and the source bud for future chats</div>
                  </div>
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                {isGeneratingTheme ? 'Generating...' : 'Generate Theme'}
              </Button>
              {(currentTheme || budConfig?.customTheme) && (
                <Button 
                  variant="outline" 
                  onClick={resetTheme}
                  className="flex-1"
                >
                  Remove Theme
                </Button>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Powered by o3 • Themes are applied to {panelMode === 'bud' ? 'this bud' : 'this conversation'}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
