'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { MCPServerList } from './MCPServerList';
import { Wrench, Settings, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MCPConfiguration {
  servers?: string[]
  available_tools?: string[]
  disabled_tools?: string[]
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
}

export interface MCPConfigurationPanelProps {
  workspaceId: string
  config?: MCPConfiguration
  onChange?: (config: MCPConfiguration) => void
  title?: string
  description?: string
  className?: string
}

export function MCPConfigurationPanel({
  workspaceId,
  config = {},
  onChange,
  title = 'MCP Configuration',
  description = 'Configure Model Context Protocol tools for this resource',
  className
}: MCPConfigurationPanelProps) {
  const [selectedServers, setSelectedServers] = useState<string[]>(config.servers || []);
  const [toolChoice, setToolChoice] = useState<string>(
    typeof config.tool_choice === 'string' ? config.tool_choice : 'auto'
  );
  const [disabledTools, setDisabledTools] = useState<string[]>(config.disabled_tools || []);

  // Update parent when configuration changes
  useEffect(() => {
    const newConfig: MCPConfiguration = {
      servers: selectedServers.length > 0 ? selectedServers : undefined,
      tool_choice: toolChoice as any,
      disabled_tools: disabledTools.length > 0 ? disabledTools : undefined
    };
    
    onChange?.(newConfig);
  }, [selectedServers, toolChoice, disabledTools]);

  const handleServerToggle = (serverId: string, selected: boolean) => {
    setSelectedServers(prev => {
      if (selected) {
        return [...prev, serverId];
      } else {
        return prev.filter(id => id !== serverId);
      }
    });
  };

  const handleToolToggle = (serverId: string, toolName: string, enabled: boolean) => {
    const toolId = `${serverId}.${toolName}`;
    
    setDisabledTools(prev => {
      if (enabled) {
        // Remove from disabled list
        return prev.filter(id => id !== toolId && id !== toolName);
      } else {
        // Add to disabled list
        return [...prev, toolId];
      }
    });
  };

  const resetConfiguration = () => {
    setSelectedServers([]);
    setToolChoice('auto');
    setDisabledTools([]);
  };

  const hasConfiguration = selectedServers.length > 0 || disabledTools.length > 0;

  return (
    <div className={className}>
      {(title || description) && (
        <div className="mb-4">
          {title && (
            <h3 className="flex items-center gap-2 text-base font-medium">
              <Wrench className="h-4 w-4" />
              {title}
            </h3>
          )}
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      )}
      
      <div className="space-y-6">
        {/* Tool Choice Setting */}
        <div className="space-y-2">
          <Label htmlFor="tool-choice">Tool Usage</Label>
          <Select value={toolChoice} onValueChange={setToolChoice}>
            <SelectTrigger>
              <SelectValue placeholder="Select tool usage mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto - Let AI decide when to use tools</SelectItem>
              <SelectItem value="required">Required - AI must use tools for every response</SelectItem>
              <SelectItem value="none">None - Disable all tool usage</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Controls when and how the AI can use available tools
          </p>
        </div>

        <Separator />

        {/* Server Selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>MCP Servers</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Select servers to enable their tools for this resource
              </p>
            </div>
            {hasConfiguration && (
              <Button variant="outline" size="sm" onClick={resetConfiguration}>
                Reset
              </Button>
            )}
          </div>

          <MCPServerList
            workspaceId={workspaceId}
            selectedServers={selectedServers}
            onServerToggle={handleServerToggle}
            onToolToggle={handleToolToggle}
            showToolSelection={true}
          />
        </div>

        {/* Configuration Summary */}
        {hasConfiguration && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label className="text-sm">Configuration Summary</Label>
              <div className="p-2 bg-muted/50 rounded text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Servers:</span>
                  <span>{selectedServers.length} selected</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Tool Choice:</span>
                  <Badge variant="outline" className="text-xs px-1.5 py-0.5">{toolChoice}</Badge>
                </div>
                {disabledTools.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Disabled Tools:</span>
                    <span>{disabledTools.length} disabled</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Help Text */}
        <div className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-950/20 rounded text-xs">
          <Info className="h-3 w-3 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-blue-700 dark:text-blue-300">
            <p className="font-medium mb-1">How MCP Tools Work:</p>
            <ul className="space-y-0.5 list-disc list-inside text-xs">
              <li>Select MCP servers to make their tools available</li>
              <li>The AI will automatically use tools when helpful</li>
              <li>Tool results are displayed in the conversation</li>
              <li>You can disable specific tools while keeping the server enabled</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}