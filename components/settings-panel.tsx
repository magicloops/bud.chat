'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronRight, HelpCircle, Palette, PanelRightClose, Save, Wrench, Sparkles } from 'lucide-react';
import { useModel } from '@/contexts/model-context';
import { useToast } from '@/hooks/use-toast';
import { BudConfig, BuiltInToolsConfig, ReasoningConfig, TextGenerationConfig } from '@/lib/types';
import { useConversation, useSetConversation } from '@/state/eventChatStore';
import { useBud, useUpdateBud } from '@/state/budStore';
import { EmojiPicker } from '@/components/EmojiPicker';
import { 
  getModelsForUI, 
  getDefaultModel, 
  supportsTemperature, 
  supportsBuiltInTools, 
  getAvailableBuiltInTools,
  supportsReasoning,
  supportsReasoningEffort,
  supportsReasoningSummary,
  supportsVerbosity,
  getAvailableReasoningEfforts,
  getAvailableReasoningSummaryTypes,
  getAvailableVerbosityLevels
} from '@/lib/modelMapping';
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
  builtInToolsConfig?: BuiltInToolsConfig
  reasoningConfig?: ReasoningConfig
  textGenerationConfig?: TextGenerationConfig
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
  const budConfig = bud?.default_json as unknown as BudConfig | undefined;
  const conversationOverrides = conversation?.meta.model_config_overrides as ConversationOverrides | undefined;
  const mcpOverrides = conversation?.meta.mcp_config_overrides as MCPConfiguration | undefined;
  const builtInToolsOverrides = conversation?.meta.builtin_tools_config_overrides as BuiltInToolsConfig | undefined;
  
  // MCP config comes from top-level mcp_config field, not nested in default_json
  const budMcpConfig = bud?.mcp_config as MCPConfiguration | undefined;
  
  // Built-in tools config comes from top-level builtin_tools_config field
  const budBuiltInToolsConfig = bud?.builtin_tools_config as BuiltInToolsConfig | undefined;

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
  const [builtInToolsConfig, setBuiltInToolsConfig] = useState<BuiltInToolsConfig>({ enabled_tools: [], tool_settings: {} });
  const [reasoningConfig, setReasoningConfig] = useState<ReasoningConfig>({});
  const [textGenerationConfig, setTextGenerationConfig] = useState<TextGenerationConfig>({});

  // Track original values for change detection
  const [originalValues, setOriginalValues] = useState({
    chatName: '',
    assistantName: '',
    aiModel: selectedModel || getDefaultModel(),
    systemPrompt: '',
    temperature: 1,
    maxTokens: undefined as number | undefined,
    avatar: '',
    mcpConfig: {} as MCPConfiguration,
    customTheme: undefined as {name: string, cssVariables: Record<string, string>} | undefined,
    builtInToolsConfig: { enabled_tools: [], tool_settings: {} } as BuiltInToolsConfig,
    reasoningConfig: {} as ReasoningConfig,
    textGenerationConfig: {} as TextGenerationConfig
  });

  // Update form values when props change
  useEffect(() => {
    // Only update if we have meaningful data to work with
    if (panelMode === 'chat' && !conversation) {
      return; // Don't update until conversation is loaded
    }
    if (panelMode === 'bud' && !bud) {
      return; // Don't update until bud is loaded
    }

    
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
      
      const finalChatName = newChatName;
      const finalAssistantName = newAssistantName;
      const finalSystemPrompt = budConfig?.systemPrompt || '';
      const finalTemperature = budConfig?.temperature || 1;
      const finalMaxTokens = budConfig?.maxTokens || undefined;
      const finalAvatar = budConfig?.avatar || '';
      const finalMcpConfig = budMcpConfig || {};
      const finalBuiltInToolsConfig = normalizeBuiltInToolsConfig(budBuiltInToolsConfig);
      const finalReasoningConfig = budConfig?.reasoningConfig || {};
      const finalTextGenerationConfig = budConfig?.textGenerationConfig || {};
      
      console.log('🔧 [Settings Panel] Bud mode final config:', {
        budBuiltInToolsConfig,
        finalBuiltInToolsConfig
      });
      
      setChatName(finalChatName);
      setAssistantName(finalAssistantName);
      setAiModel(validModel);
      setSystemPrompt(finalSystemPrompt);
      setTemperature(finalTemperature);
      setMaxTokens(finalMaxTokens);
      setAvatar(finalAvatar);
      setMcpConfig(finalMcpConfig);
      setBuiltInToolsConfig(finalBuiltInToolsConfig);
      setReasoningConfig(finalReasoningConfig);
      setTextGenerationConfig(finalTextGenerationConfig);
      
      // Set original values for bud mode
      setOriginalValues({
        chatName: finalChatName,
        assistantName: finalAssistantName,
        aiModel: validModel,
        systemPrompt: finalSystemPrompt,
        temperature: finalTemperature,
        maxTokens: finalMaxTokens,
        avatar: finalAvatar,
        mcpConfig: finalMcpConfig,
        customTheme: budConfig?.customTheme,
        builtInToolsConfig: finalBuiltInToolsConfig,
        reasoningConfig: finalReasoningConfig,
        textGenerationConfig: finalTextGenerationConfig
      });
    } else {
      // Chat mode: Use conversation overrides with bud fallbacks
      const newChatName = conversation?.meta.title || '';
      const newAssistantName = conversationOverrides?.assistantName || conversation?.meta.assistant_name || budConfig?.name || '';
      const chatModel = conversationOverrides?.model || budConfig?.model || getDefaultModel();
      
      // Validate model exists in available options
      const validModel = availableModels.includes(chatModel) ? chatModel : getDefaultModel();
      
      const finalChatName = newChatName;
      const finalAssistantName = newAssistantName;
      const finalSystemPrompt = conversationOverrides?.systemPrompt || budConfig?.systemPrompt || '';
      const finalTemperature = conversationOverrides?.temperature || budConfig?.temperature || 1;
      const finalMaxTokens = conversationOverrides?.maxTokens || budConfig?.maxTokens || undefined;
      const finalAvatar = conversationOverrides?.avatar || conversation?.meta.assistant_avatar || budConfig?.avatar || '';
      const finalMcpConfig = mcpOverrides || budMcpConfig || {};
      const finalBuiltInToolsConfig = normalizeBuiltInToolsConfig(builtInToolsOverrides || budBuiltInToolsConfig);
      const finalReasoningConfig = conversationOverrides?.reasoningConfig || budConfig?.reasoningConfig || {};
      const finalTextGenerationConfig = conversationOverrides?.textGenerationConfig || budConfig?.textGenerationConfig || {};
      
      setChatName(finalChatName);
      setAssistantName(finalAssistantName);
      setAiModel(validModel);
      setSystemPrompt(finalSystemPrompt);
      setTemperature(finalTemperature);
      setMaxTokens(finalMaxTokens);
      setAvatar(finalAvatar);
      setMcpConfig(finalMcpConfig);
      setBuiltInToolsConfig(finalBuiltInToolsConfig);
      setReasoningConfig(finalReasoningConfig);
      setTextGenerationConfig(finalTextGenerationConfig);
      
      // Set original values for chat mode
      setOriginalValues({
        chatName: finalChatName,
        assistantName: finalAssistantName,
        aiModel: validModel,
        systemPrompt: finalSystemPrompt,
        temperature: finalTemperature,
        maxTokens: finalMaxTokens,
        avatar: finalAvatar,
        mcpConfig: finalMcpConfig,
        customTheme: budConfig?.customTheme,
        builtInToolsConfig: finalBuiltInToolsConfig,
        reasoningConfig: finalReasoningConfig,
        textGenerationConfig: finalTextGenerationConfig
      });
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

  // Helper function to normalize MCP config for comparison
  const normalizeMcpConfig = (config: MCPConfiguration) => {
    const normalized: MCPConfiguration = {};
    
    // Only include non-default, non-empty values
    if (config.servers && config.servers.length > 0) {
      normalized.servers = config.servers;
    }
    if (config.disabled_tools && config.disabled_tools.length > 0) {
      normalized.disabled_tools = config.disabled_tools;
    }
    // Only include tool_choice if it's not the default 'auto'
    if (config.tool_choice && config.tool_choice !== 'auto') {
      normalized.tool_choice = config.tool_choice;
    }
    
    return normalized;
  };

  // Ensure built-in tools config always has required shape
  const normalizeBuiltInToolsConfig = (
    cfg?: Partial<BuiltInToolsConfig> | null
  ): BuiltInToolsConfig => {
    let enabled: string[] = [];
    if (cfg && Array.isArray(cfg.enabled_tools)) {
      enabled = cfg.enabled_tools as string[];
    }
    let settings: Record<string, Record<string, unknown>> = {};
    if (cfg && cfg.tool_settings && typeof cfg.tool_settings === 'object') {
      settings = cfg.tool_settings as Record<string, Record<string, unknown>>;
    }
    return { enabled_tools: enabled, tool_settings: settings };
  };

  // Effect to check for changes whenever form values change
  useEffect(() => {
    const currentValues = {
      chatName,
      assistantName,
      aiModel,
      systemPrompt,
      temperature,
      maxTokens,
      avatar,
      mcpConfig
    };
    
    // Normalize MCP configs for comparison
    const currentMcpNormalized = normalizeMcpConfig(currentValues.mcpConfig);
    const originalMcpNormalized = normalizeMcpConfig(originalValues.mcpConfig);
    const mcpConfigChanged = JSON.stringify(currentMcpNormalized) !== JSON.stringify(originalMcpNormalized);
    
    // Deep compare with original values
    const hasChanges = 
      currentValues.chatName !== originalValues.chatName ||
      currentValues.assistantName !== originalValues.assistantName ||
      currentValues.aiModel !== originalValues.aiModel ||
      currentValues.systemPrompt !== originalValues.systemPrompt ||
      currentValues.temperature !== originalValues.temperature ||
      currentValues.maxTokens !== originalValues.maxTokens ||
      currentValues.avatar !== originalValues.avatar ||
      mcpConfigChanged ||
      JSON.stringify(currentTheme) !== JSON.stringify(originalValues.customTheme);
    
    
    setHasUnsavedChanges(hasChanges);
  }, [chatName, assistantName, aiModel, systemPrompt, temperature, maxTokens, avatar, mcpConfig, currentTheme, originalValues]);

  // Handle value changes - track for save confirmation in both modes
  const handleFieldChange = (field: string, value: string | number | boolean | object) => {
    switch (field) {
      case 'name':
        setChatName(value as string);
        break;
      case 'assistantName':
        setAssistantName(value as string);
        break;
      case 'model':
        setAiModel(value as string);
        setSelectedModel(value as string);
        break;
      case 'systemPrompt':
        setSystemPrompt(value as string);
        break;
      case 'temperature':
        setTemperature(value as number);
        break;
      case 'maxTokens':
        setMaxTokens(value as number | undefined);
        break;
      case 'avatar':
        setAvatar(value as string);
        break;
      case 'mcpConfig':
        setMcpConfig(value as object);
        break;
      case 'builtInToolsConfig':
        setBuiltInToolsConfig(value as BuiltInToolsConfig);
        break;
      case 'reasoningConfig':
        setReasoningConfig(value as ReasoningConfig);
        break;
      case 'textGenerationConfig':
        setTextGenerationConfig(value as TextGenerationConfig);
        break;
    }
  };

  // Stable callback for MCP configuration changes
  const handleMcpConfigChange = useCallback((config: MCPConfiguration) => {
    setMcpConfig(config);
    // Change detection will be handled by the useEffect
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
    } catch (_error) {
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
        const currentConfig = bud.default_json as unknown as BudConfig;
        const updatedConfig: BudConfig = {
          ...currentConfig,
          name: assistantName || currentConfig.name || 'Untitled Bud', // Use assistantName for bud name
          model: aiModel || currentConfig.model || 'gpt-4o',
          systemPrompt: systemPrompt || currentConfig.systemPrompt || '',
          temperature: temperature,
          maxTokens: maxTokens,
          avatar: avatar || currentConfig.avatar || '',
          customTheme: currentTheme,
          mcpConfig: mcpConfig,
          reasoningConfig: Object.keys(reasoningConfig).length > 0 ? reasoningConfig : undefined,
          textGenerationConfig: Object.keys(textGenerationConfig).length > 0 ? textGenerationConfig : undefined
        };
        
        await updateBud(bud.id, { 
          config: updatedConfig, 
          builtInToolsConfig: builtInToolsConfig 
        });
        
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
        mcpConfig: JSON.stringify(mcpConfig) !== JSON.stringify(budConfig?.mcpConfig || {}) ? mcpConfig : undefined,
        builtInToolsConfig: JSON.stringify(builtInToolsConfig) !== JSON.stringify(budBuiltInToolsConfig || { enabled_tools: [], tool_settings: {} }) ? builtInToolsConfig : undefined,
        reasoningConfig: JSON.stringify(reasoningConfig) !== JSON.stringify(budConfig?.reasoningConfig || {}) ? reasoningConfig : undefined,
        textGenerationConfig: JSON.stringify(textGenerationConfig) !== JSON.stringify(budConfig?.textGenerationConfig || {}) ? textGenerationConfig : undefined
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
          model_config_overrides: Object.keys(currentOverrides).length > 0 ? currentOverrides as Record<string, unknown> : undefined
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
            mcp_config_overrides: Object.keys(mcpConfig).length > 0 ? mcpConfig : null,
            builtin_tools_config_overrides: currentOverrides.builtInToolsConfig ? builtInToolsConfig : null 
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
        
        await updateBud(bud.id, { 
          config: updatedBudConfig, 
          builtInToolsConfig: builtInToolsConfig 
        });
        
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
              mcp_config_overrides: null, // Clear MCP overrides since they're now in the bud
              builtin_tools_config_overrides: null // Clear built-in tools overrides since they're now in the bud
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

                {/* Built-in Tools - only show for supported models */}
                {supportsBuiltInTools(aiModel) && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      <label className="text-sm font-medium">Built-in Tools</label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enable OpenAI&apos;s built-in tools for enhanced capabilities with {aiModel}.
                    </p>
                    
                    {getAvailableBuiltInTools(aiModel).map(tool => (
                      <div key={tool.type} className="space-y-3">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={tool.type}
                            checked={builtInToolsConfig.enabled_tools.includes(tool.type)}
                            onCheckedChange={(checked) => {
                              const updatedTools = checked
                                ? [...builtInToolsConfig.enabled_tools, tool.type]
                                : builtInToolsConfig.enabled_tools.filter(t => t !== tool.type);
                              
                              const updatedConfig = {
                                ...builtInToolsConfig,
                                enabled_tools: updatedTools
                              };
                              setBuiltInToolsConfig(updatedConfig);
                              handleFieldChange('builtInToolsConfig', updatedConfig);
                            }}
                          />
                          <div className="grid gap-1.5 leading-none">
                            <label 
                              htmlFor={tool.type}
                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                              {tool.name}
                            </label>
                            <p className="text-xs text-muted-foreground">
                              {tool.description}
                            </p>
                          </div>
                        </div>
                        
                        {/* Tool-specific settings */}
                        {builtInToolsConfig.enabled_tools.includes(tool.type) && (
                          <div className="ml-6 space-y-2">
                            {tool.type === 'web_search_preview' && (
                              <div>
                                <label className="text-xs font-medium">Search Context Size</label>
                                <Select
                                  value={(
                                    builtInToolsConfig.tool_settings[tool.type] as { search_context_size?: string } | undefined
                                  )?.search_context_size ?? 'medium'}
                                  onValueChange={(value) => {
                                    const updatedConfig = {
                                      ...builtInToolsConfig,
                                      tool_settings: {
                                        ...builtInToolsConfig.tool_settings,
                                        [tool.type]: {
                                          ...builtInToolsConfig.tool_settings[tool.type],
                                          search_context_size: value
                                        }
                                      }
                                    };
                                    setBuiltInToolsConfig(updatedConfig);
                                    handleFieldChange('builtInToolsConfig', updatedConfig);
                                  }}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="low">Low - Minimal context</SelectItem>
                                    <SelectItem value="medium">Medium - Balanced context</SelectItem>
                                    <SelectItem value="high">High - Maximum context</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            
                            {tool.type === 'code_interpreter' && (
                              <div>
                                <label className="text-xs font-medium">Container</label>
                                <Select
                                  value={(
                                    builtInToolsConfig.tool_settings[tool.type] as { container?: string } | undefined
                                  )?.container ?? 'default'}
                                  onValueChange={(value) => {
                                    const updatedConfig = {
                                      ...builtInToolsConfig,
                                      tool_settings: {
                                        ...builtInToolsConfig.tool_settings,
                                        [tool.type]: {
                                          ...builtInToolsConfig.tool_settings[tool.type],
                                          container: value
                                        }
                                      }
                                    };
                                    setBuiltInToolsConfig(updatedConfig);
                                    handleFieldChange('builtInToolsConfig', updatedConfig);
                                  }}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="default">Default Python Environment</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Reasoning Configuration - only show for reasoning models */}
                {supportsReasoning(aiModel) && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      <label className="text-sm font-medium">Reasoning Configuration</label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Configure how {aiModel} approaches reasoning for better performance and control.
                    </p>
                    
                    {supportsReasoningEffort(aiModel) && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Reasoning Effort</label>
                        <Select
                          value={reasoningConfig.effort || 'medium'}
                          onValueChange={(value) => {
                            const updatedConfig = {
                              ...reasoningConfig,
                              effort: value as 'minimal' | 'low' | 'medium' | 'high'
                            };
                            setReasoningConfig(updatedConfig);
                            handleFieldChange('reasoningConfig', updatedConfig);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {getAvailableReasoningEfforts(aiModel, builtInToolsConfig.enabled_tools.length > 0).map(effort => (
                              <SelectItem key={effort} value={effort}>
                                <div className="flex flex-col">
                                  <span className="capitalize">{effort}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {effort === 'minimal' && 'Fastest response, minimal reasoning'}
                                    {effort === 'low' && 'Fast response, basic reasoning'}
                                    {effort === 'medium' && 'Balanced speed and reasoning quality'}
                                    {effort === 'high' && 'Thorough reasoning, slower response'}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Controls how much computational effort the model puts into reasoning before responding.
                        </p>
                      </div>
                    )}
                    
                    {supportsReasoningSummary(aiModel) && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Reasoning Summary</label>
                        <Select
                          value={reasoningConfig.summary || (aiModel.startsWith('gpt-5') ? 'detailed' : 'auto')}
                          onValueChange={(value) => {
                            const updatedConfig = {
                              ...reasoningConfig,
                              summary: value as 'auto' | 'concise' | 'detailed'
                            };
                            setReasoningConfig(updatedConfig);
                            handleFieldChange('reasoningConfig', updatedConfig);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {getAvailableReasoningSummaryTypes(aiModel).map(summaryType => (
                              <SelectItem key={summaryType} value={summaryType}>
                                <div className="flex flex-col">
                                  <span className="capitalize">{summaryType}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {summaryType === 'auto' && 'Automatic summary generation'}
                                    {summaryType === 'concise' && 'Brief reasoning summary'}
                                    {summaryType === 'detailed' && 'Comprehensive reasoning explanation'}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Choose how detailed the reasoning explanation should be in the response.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Verbosity Configuration - only show for verbosity-supporting models */}
                {supportsVerbosity(aiModel) && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      <label className="text-sm font-medium">Response Verbosity</label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Control how verbose and detailed the model&apos;s responses are.
                    </p>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Verbosity Level</label>
                      <Select
                        value={textGenerationConfig.verbosity || 'medium'}
                        onValueChange={(value) => {
                          const updatedConfig = {
                            ...textGenerationConfig,
                            verbosity: value as 'low' | 'medium' | 'high'
                          };
                          setTextGenerationConfig(updatedConfig);
                          handleFieldChange('textGenerationConfig', updatedConfig);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableVerbosityLevels(aiModel).map(verbosity => (
                            <SelectItem key={verbosity} value={verbosity}>
                              <div className="flex flex-col">
                                <span className="capitalize">{verbosity}</span>
                                <span className="text-xs text-muted-foreground">
                                  {verbosity === 'low' && 'Concise, minimal commentary'}
                                  {verbosity === 'medium' && 'Balanced detail and brevity'}
                                  {verbosity === 'high' && 'Detailed explanations and examples'}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Affects response length and detail level. High verbosity provides more thorough explanations.
                      </p>
                    </div>
                  </div>
                )}

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
                      placeholder="Your Bud&apos;s goal, personality, and info it needs. (Recommended)"
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
                      key={`mcp-config-${panelMode}-${conversationId || 'no-conv'}-${bud?.id || 'no-bud'}`}
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
                  {supportsTemperature(aiModel) && (
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
                  )}
                  {!supportsTemperature(aiModel) && (
                    <div className="p-3 bg-muted/50 rounded border">
                      <p className="text-sm text-muted-foreground">
                        <strong>Note:</strong> Temperature settings are not supported by {aiModel}. This model uses fixed parameters optimized for reasoning.
                      </p>
                    </div>
                  )}

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
                        handleFieldChange('maxTokens', value || 0);
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
