'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Plus, Server } from 'lucide-react'

interface MCPServerFormProps {
  workspaceId: string
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

interface MCPServerFormData {
  name: string
  endpoint: string
  transport_type: 'http' | 'stdio' | 'websocket'
  description: string
  tools: string
}

const DEFAULT_TEST_SERVER: MCPServerFormData = {
  name: 'HTTP Calculator Test Server',
  endpoint: 'http://localhost:3001/mcp',
  transport_type: 'http',
  description: 'A test MCP server with calculator tools using HTTP transport',
  tools: 'add, calculate'
}

export function MCPServerForm({ workspaceId, open, onClose, onSuccess }: MCPServerFormProps) {
  const [formData, setFormData] = useState<MCPServerFormData>(DEFAULT_TEST_SERVER)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrors([])

    try {
      // Validate required fields
      if (!formData.name.trim() || !formData.endpoint.trim()) {
        setErrors(['Name and endpoint are required'])
        return
      }

      // Build metadata object
      const metadata = {
        description: formData.description,
        version: '1.0.0',
        tools: formData.tools
          .split(',')
          .map(tool => tool.trim())
          .filter(tool => tool.length > 0),
        capabilities: formData.transport_type === 'stdio' 
          ? ['JavaScript execution in sandboxed environment', 'Mathematical calculations', 'Array operations (sum, average, min, max, sort)']
          : ['External API integration']
      }

      const response = await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceId,
          name: formData.name,
          endpoint: formData.endpoint,
          transport_type: formData.transport_type,
          metadata
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create MCP server')
      }

      // Success - close form and refresh parent
      onSuccess()
      onClose()
      
      // Reset form for next use
      setFormData(DEFAULT_TEST_SERVER)
      
    } catch (error) {
      console.error('Failed to create MCP server:', error)
      setErrors([error instanceof Error ? error.message : 'Failed to create MCP server'])
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setFormData(DEFAULT_TEST_SERVER)
    setErrors([])
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto z-[60]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Add MCP Server
          </DialogTitle>
          <DialogDescription>
            Connect an external MCP server to enable tool calling capabilities
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
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

          {/* Quick Start Note */}
          <Card className="border-blue-200 bg-blue-50/50">
            <CardContent className="pt-4">
              <p className="text-sm text-blue-800">
                💡 <strong>Quick Start:</strong> The form is pre-filled with our JavaScript test server. 
                Just click "Add Server" to get started, or customize the settings below.
              </p>
            </CardContent>
          </Card>

          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Server Name *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="My MCP Server"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Endpoint *</label>
              <Input
                value={formData.endpoint}
                onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                placeholder="http://localhost:8000 or node /path/to/server.js"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                For stdio transport: Command to run the server (e.g., "node server.js")
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Transport Type *</label>
              <Select 
                value={formData.transport_type} 
                onValueChange={(value: 'http' | 'stdio' | 'websocket') => 
                  setFormData({ ...formData, transport_type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">
                    <div>
                      <div className="font-medium">stdio</div>
                      <div className="text-xs text-muted-foreground">Local process communication</div>
                    </div>
                  </SelectItem>
                  <SelectItem value="http">
                    <div>
                      <div className="font-medium">HTTP</div>
                      <div className="text-xs text-muted-foreground">REST API communication</div>
                    </div>
                  </SelectItem>
                  <SelectItem value="websocket">
                    <div>
                      <div className="font-medium">WebSocket</div>
                      <div className="text-xs text-muted-foreground">Real-time bidirectional communication</div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Metadata */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Server Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  placeholder="What does this MCP server do?"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Available Tools</label>
                <Input
                  value={formData.tools}
                  onChange={(e) => setFormData({ ...formData, tools: e.target.value })}
                  placeholder="tool1, tool2, tool3"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Comma-separated list of tool names this server provides
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-between pt-4 border-t">
            <Button type="button" variant="outline" onClick={handleReset}>
              Reset to Test Server
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Plus className="h-4 w-4 mr-2" />
                Add Server
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}