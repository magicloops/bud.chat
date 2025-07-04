'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { 
  Wrench, 
  Server, 
  CheckCircle, 
  XCircle, 
  Loader2,
  Plus,
  Settings,
  TestTube
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MCPServerForm } from './MCPServerForm'

export interface MCPServer {
  id: string
  name: string
  endpoint: string
  transport_type: 'http' | 'stdio' | 'websocket'
  is_active: boolean
  metadata?: {
    description?: string
    tools?: string[]
  }
  mcp_tools?: Array<{
    id: string
    name: string
    description?: string
    is_enabled: boolean
  }>
}

export interface MCPServerListProps {
  workspaceId: string
  selectedServers?: string[]
  onServerToggle?: (serverId: string, selected: boolean) => void
  onToolToggle?: (serverId: string, toolName: string, enabled: boolean) => void
  showToolSelection?: boolean
  className?: string
}

export function MCPServerList({
  workspaceId,
  selectedServers = [],
  onServerToggle,
  onToolToggle,
  showToolSelection = false,
  className
}: MCPServerListProps) {
  const [servers, setServers] = useState<MCPServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [testingServers, setTestingServers] = useState<Set<string>>(new Set())
  const [showAddForm, setShowAddForm] = useState(false)

  // Fetch MCP servers for the workspace
  const fetchServers = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/mcp/servers?workspaceId=${workspaceId}`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch MCP servers')
      }
      
      const { data } = await response.json()
      setServers(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (workspaceId) {
      fetchServers()
    }
  }, [workspaceId])

  const handleServerToggle = (serverId: string, selected: boolean) => {
    onServerToggle?.(serverId, selected)
  }

  const handleToolToggle = (serverId: string, toolName: string, enabled: boolean) => {
    onToolToggle?.(serverId, toolName, enabled)
  }

  const testServerConnection = async (serverId: string) => {
    setTestingServers(prev => new Set([...prev, serverId]))
    
    try {
      const response = await fetch(`/api/mcp/servers/${serverId}/test`, {
        method: 'POST'
      })
      
      const result = await response.json()
      
      if (result.data?.success) {
        // Show success feedback
        console.log('Server test successful:', result.data)
      } else {
        // Show error feedback
        console.error('Server test failed:', result.data?.error)
      }
    } catch (error) {
      console.error('Server test error:', error)
    } finally {
      setTestingServers(prev => {
        const newSet = new Set(prev)
        newSet.delete(serverId)
        return newSet
      })
    }
  }

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center p-8", className)}>
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading MCP servers...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn("p-4 bg-destructive/10 border border-destructive/20 rounded-lg", className)}>
        <p className="text-destructive">Error: {error}</p>
      </div>
    )
  }

  const renderEmptyState = () => (
    <div className={cn("text-center p-8", className)}>
      <Server className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium mb-2">No MCP Servers</h3>
      <p className="text-muted-foreground mb-4">
        Add MCP servers to enable tool calling capabilities for your Buds.
      </p>
      <Button type="button" onClick={() => setShowAddForm(true)}>
        <Plus className="h-4 w-4 mr-2" />
        Add MCP Server
      </Button>
    </div>
  )

  const renderServerList = () => (
    <div className={cn("space-y-4", className)}>
      {/* Add Server Button */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">
          {servers.length} server{servers.length !== 1 ? 's' : ''} available
        </div>
        <Button 
          type="button"
          variant="outline" 
          size="sm" 
          onClick={() => setShowAddForm(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Server
        </Button>
      </div>

      {servers.map((server) => {
        const isSelected = selectedServers.includes(server.id)
        const isTesting = testingServers.has(server.id)
        
        return (
          <Card key={server.id} className={cn(
            "transition-colors",
            isSelected && "ring-2 ring-primary"
          )}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  {onServerToggle && (
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => handleServerToggle(server.id, checked as boolean)}
                      className="mt-1"
                    />
                  )}
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Wrench className="h-4 w-4" />
                      {server.name}
                      <Badge variant={server.is_active ? "default" : "secondary"}>
                        {server.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {server.transport_type}
                      </Badge>
                    </CardTitle>
                    {server.metadata?.description && (
                      <CardDescription className="mt-1">
                        {server.metadata.description}
                      </CardDescription>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => testServerConnection(server.id)}
                    disabled={isTesting}
                  >
                    {isTesting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <TestTube className="h-4 w-4" />
                    )}
                  </Button>
                  <Button type="button" variant="ghost" size="sm">
                    <Settings className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            
            {/* Show tools if expanded or tool selection is enabled */}
            {(showToolSelection || isSelected) && server.mcp_tools && server.mcp_tools.length > 0 && (
              <CardContent className="pt-0">
                <div className="text-sm font-medium mb-2">Available Tools:</div>
                <div className="grid grid-cols-1 gap-2">
                  {server.mcp_tools.map((tool) => (
                    <div key={tool.id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                      <div>
                        <div className="font-medium text-sm">{tool.name}</div>
                        {tool.description && (
                          <div className="text-xs text-muted-foreground">{tool.description}</div>
                        )}
                      </div>
                      {onToolToggle && (
                        <Switch
                          checked={tool.is_enabled}
                          onCheckedChange={(checked) => handleToolToggle(server.id, tool.name, checked)}
                          size="sm"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}
    </div>
  )

  return (
    <>
      {servers.length === 0 ? renderEmptyState() : renderServerList()}

      {/* MCP Server Form - Always render so it can show/hide */}
      <MCPServerForm
        workspaceId={workspaceId}
        open={showAddForm}
        onClose={() => setShowAddForm(false)}
        onSuccess={() => {
          fetchServers() // Refresh the server list
        }}
      />
    </>
  )
}