'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles } from 'lucide-react';
import { EmojiPicker } from '@/components/EmojiPicker';
import { MCPConfigurationPanel, MCPConfiguration } from '@/components/MCP';
import { Bud, BudConfig, BuiltInToolsConfig, ReasoningConfig, TextGenerationConfig } from '@/lib/types';
import { getBudConfig, getDefaultBudConfig, validateBudConfig, BUD_TEMPLATES } from '@/lib/budHelpers';
import { 
  getModelsForUI, 
  supportsTemperature, 
  getAvailableBuiltInTools, 
  supportsBuiltInTools,
  supportsReasoning,
  supportsReasoningEffort,
  supportsReasoningSummary,
  supportsVerbosity,
  getAvailableReasoningEfforts,
  getAvailableReasoningSummaryTypes,
  getAvailableVerbosityLevels
} from '@/lib/modelMapping';
import { Checkbox } from '@/components/ui/checkbox';

interface BudFormProps {
  bud?: Bud
  workspaceId: string
  open: boolean
  onClose: () => void
  onSave: (config: BudConfig, name: string, builtInToolsConfig?: BuiltInToolsConfig) => Promise<void>
  loading?: boolean
}

export function BudForm({ bud, workspaceId, open, onClose, onSave, loading = false }: BudFormProps) {
  const [config, setConfig] = useState<BudConfig>(() => 
    bud ? getBudConfig(bud) : getDefaultBudConfig()
  );
  const [mcpConfig, setMcpConfig] = useState<MCPConfiguration>(
    config.mcpConfig || {}
  );
  const [builtInToolsConfig, setBuiltInToolsConfig] = useState<BuiltInToolsConfig>(() => {
    // Initialize built-in tools config from bud or default
    if (bud?.builtin_tools_config) {
      return bud.builtin_tools_config;
    }
    return {
      enabled_tools: [],
      tool_settings: {}
    };
  });
  const [errors, setErrors] = useState<string[]>([]);

  // Reset form when bud changes
  useEffect(() => {
    if (bud) {
      const budConfig = getBudConfig(bud);
      setConfig(budConfig);
      setMcpConfig(budConfig.mcpConfig || {});
      setBuiltInToolsConfig(bud.builtin_tools_config || {
        enabled_tools: [],
        tool_settings: {}
      });
    } else {
      const defaultConfig = getDefaultBudConfig();
      setConfig(defaultConfig);
      setMcpConfig({});
      setBuiltInToolsConfig({
        enabled_tools: [],
        tool_settings: {}
      });
    }
    setErrors([]);
  }, [bud]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate
    const validationErrors = validateBudConfig(config);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    
    setErrors([]);
    
    try {
      // Include MCP configuration in the config
      const finalConfig = {
        ...config,
        mcpConfig: Object.keys(mcpConfig).length > 0 ? mcpConfig : undefined
      };
      
      // Pass built-in tools config separately since it's stored in a separate DB column
      const finalBuiltInToolsConfig = builtInToolsConfig.enabled_tools.length > 0 
        ? builtInToolsConfig 
        : { enabled_tools: [], tool_settings: {} };
        
      await onSave(finalConfig, config.name, finalBuiltInToolsConfig);
      onClose();
    } catch (error) {
      console.error('Failed to save bud:', error);
      setErrors([error instanceof Error ? error.message : 'Failed to save bud']);
    }
  };

  const handleTemplateSelect = (templateKey: string) => {
    const template = BUD_TEMPLATES[templateKey];
    if (template) {
      setConfig({ ...getDefaultBudConfig(), ...template });
    }
  };

  const isEditing = !!bud;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Bud' : 'Create New Bud'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Template Selection */}
          {!isEditing && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Quick Start Templates</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {Object.entries(BUD_TEMPLATES).map(([key, template]) => (
                    <Button
                      key={key}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleTemplateSelect(key)}
                      className="h-auto p-3 w-full text-left"
                    >
                      <div className="flex items-center gap-2 w-full">
                        <span className="text-lg">{template.avatar}</span>
                        <span className="text-sm font-medium truncate flex-1">{template.name}</span>
                      </div>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <Card className="border-destructive">
              <CardContent className="pt-4">
                <ul className="text-sm text-destructive space-y-1">
                  {errors.map((error, i) => (
                    <li key={i}>• {error}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Name *</label>
              <Input
                value={config.name}
                onChange={(e) => setConfig({...config, name: e.target.value})}
                placeholder="My Assistant"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Avatar</label>
              <EmojiPicker
                value={config.avatar || ''}
                onSelect={(emoji) => setConfig({...config, avatar: emoji})}
                placeholder="Pick an emoji for your bud"
              />
            </div>
          </div>
          
          {/* System Prompt */}
          <div>
            <label className="block text-sm font-medium mb-2">System Prompt *</label>
            <Textarea
              value={config.systemPrompt}
              onChange={(e) => setConfig({...config, systemPrompt: e.target.value})}
              rows={6}
              placeholder="You are a helpful assistant that..."
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              This defines your bud&apos;s personality and instructions.
            </p>
          </div>
          
          {/* Model Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                AI Model Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Model *</label>
                  <Select value={config.model} onValueChange={(model) => setConfig({...config, model})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getModelsForUI().map((model) => (
                        <SelectItem key={model.value} value={model.value}>
                          <div className="flex items-center gap-2">
                            <Badge variant={model.provider === 'anthropic' ? 'outline' : 'secondary'}>
                              {model.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                            </Badge>
                            {model.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Max Tokens</label>
                  <Input
                    type="number"
                    value={config.maxTokens || ''}
                    onChange={(e) => setConfig({...config, maxTokens: e.target.value ? parseInt(e.target.value) : undefined})}
                    placeholder="2048"
                    min="1"
                    max="32000"
                  />
                </div>
              </div>
              
              {supportsTemperature(config.model) && (
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Temperature: {config.temperature || 0.7}
                  </label>
                  <Slider 
                    value={[config.temperature || 0.7]} 
                    onValueChange={([temp]) => setConfig({...config, temperature: temp})}
                    min={0} 
                    max={1} 
                    step={0.1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Focused</span>
                    <span>Balanced</span>
                    <span>Creative</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Controls response creativity and randomness.
                  </p>
                </div>
              )}
              {!supportsTemperature(config.model) && (
                <div className="p-3 bg-muted/50 rounded border">
                  <p className="text-sm text-muted-foreground">
                    <strong>Note:</strong> Temperature settings are not supported by {config.model}. This model uses fixed parameters optimized for reasoning.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Built-in Tools Configuration */}
          {supportsBuiltInTools(config.model) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Built-in Tools
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Enable OpenAI's built-in tools for enhanced capabilities. These tools are only available for {config.model}.
                </p>
                
                {getAvailableBuiltInTools(config.model).map(tool => (
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
                              value={builtInToolsConfig.tool_settings[tool.type]?.search_context_size || 'medium'}
                              onValueChange={(value) => {
                                setBuiltInToolsConfig({
                                  ...builtInToolsConfig,
                                  tool_settings: {
                                    ...builtInToolsConfig.tool_settings,
                                    [tool.type]: {
                                      ...builtInToolsConfig.tool_settings[tool.type],
                                      search_context_size: value
                                    }
                                  }
                                });
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
                      </div>
                    )}
                  </div>
                ))}
                
                {getAvailableBuiltInTools(config.model).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No built-in tools are available for this model.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          
          {/* Reasoning Configuration */}
          {supportsReasoning(config.model) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Reasoning Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Configure how {config.model} approaches reasoning for better performance and control.
                </p>
                
                {supportsReasoningEffort(config.model) && (
                  <div>
                    <label className="block text-sm font-medium mb-2">Reasoning Effort</label>
                    <Select
                      value={config.reasoningConfig?.effort || 'medium'}
                      onValueChange={(value) => {
                        setConfig({
                          ...config,
                          reasoningConfig: {
                            ...config.reasoningConfig,
                            effort: value as 'minimal' | 'low' | 'medium' | 'high'
                          }
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {getAvailableReasoningEfforts(config.model, builtInToolsConfig.enabled_tools.length > 0).map(effort => (
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
                    <p className="text-xs text-muted-foreground mt-1">
                      Controls how much computational effort the model puts into reasoning before responding.
                    </p>
                  </div>
                )}
                
                {supportsReasoningSummary(config.model) && (
                  <div>
                    <label className="block text-sm font-medium mb-2">Reasoning Summary</label>
                    <Select
                      value={config.reasoningConfig?.summary || (config.model.startsWith('gpt-5') ? 'detailed' : 'auto')}
                      onValueChange={(value) => {
                        setConfig({
                          ...config,
                          reasoningConfig: {
                            ...config.reasoningConfig,
                            summary: value as 'auto' | 'concise' | 'detailed'
                          }
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {getAvailableReasoningSummaryTypes(config.model).map(summaryType => (
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
                    <p className="text-xs text-muted-foreground mt-1">
                      Choose how detailed the reasoning explanation should be in the response.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          
          {/* Verbosity Configuration */}
          {supportsVerbosity(config.model) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Response Verbosity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Control how verbose and detailed the model&apos;s responses are.
                </p>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Verbosity Level</label>
                  <Select
                    value={config.textGenerationConfig?.verbosity || 'medium'}
                    onValueChange={(value) => {
                      setConfig({
                        ...config,
                        textGenerationConfig: {
                          ...config.textGenerationConfig,
                          verbosity: value as 'low' | 'medium' | 'high'
                        }
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailableVerbosityLevels(config.model).map(verbosity => (
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Affects response length and detail level. High verbosity provides more thorough explanations.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* MCP Configuration */}
          <MCPConfigurationPanel
            workspaceId={workspaceId}
            config={mcpConfig}
            onChange={setMcpConfig}
            title="Tool Integration"
            description="Enable external tools and capabilities for this Bud"
          />
          
          {/* Optional Greeting */}
          <div>
            <label className="block text-sm font-medium mb-2">Greeting Message (Optional)</label>
            <Textarea
              value={config.greeting || ''}
              onChange={(e) => setConfig({...config, greeting: e.target.value})}
              rows={3}
              placeholder="Hello! I'm here to help you with..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              This message will appear when starting a new conversation with this bud.
            </p>
          </div>
          
          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEditing ? 'Update Bud' : 'Create Bud'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}