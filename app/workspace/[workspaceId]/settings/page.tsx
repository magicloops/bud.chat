'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertCircle, Plus, Edit, Trash2, Settings, TestTube, Save, X, ArrowLeft } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

import { Bud, BudConfig, RemoteMCPConfig } from '@/lib/types';
import { budManager, getBudConfig, getBudDisplayName, getBudAvatar, getBudModel } from '@/lib/budHelpers';
import { getModelsForUI } from '@/lib/modelMapping';
import { Database } from '@/lib/types/database';

type MCPServer = Database['public']['Tables']['mcp_servers']['Row'];

interface EditingBud extends Bud {
  isEditing: boolean;
  editConfig: BudConfig;
}

export default function WorkspaceSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.workspaceId as string;

  // State management
  const [buds, setBuds] = useState<EditingBud[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testingServer, setTestingServer] = useState<string | null>(null);
  
  // Dialog states
  const [showNewBudDialog, setShowNewBudDialog] = useState(false);
  const [showNewMCPDialog, setShowNewMCPDialog] = useState(false);
  const [editingMCPServer, setEditingMCPServer] = useState<MCPServer | null>(null);
  const [newBudConfig, setNewBudConfig] = useState<Partial<BudConfig>>({
    name: '',
    systemPrompt: 'You are a helpful, harmless, and honest AI assistant.',
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 2048,
    avatar: '🤖'
  });
  const [newMCPServer, setNewMCPServer] = useState({
    name: '',
    endpoint: '',
    transport_type: 'http',
    auth_config: '',
    is_active: true
  });

  const models = getModelsForUI();

  // Load data
  useEffect(() => {
    const loadWorkspaceData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Load buds
        const workspaceBuds = await budManager.getWorkspaceBuds(workspaceId);
        setBuds(workspaceBuds.map(bud => ({
          ...bud,
          isEditing: false,
          editConfig: getBudConfig(bud)
        })));

        // Load MCP servers
        const mcpResponse = await fetch(`/api/mcp/servers?workspaceId=${workspaceId}`);
        if (!mcpResponse.ok) {
          throw new Error('Failed to load MCP servers');
        }
        const mcpData = await mcpResponse.json();
        setMcpServers(mcpData.data || []);

        // Debug logging to help diagnose the MCP server issue
        console.log('🔍 Debug - Workspace ID:', workspaceId);
        console.log('🔍 Debug - Loaded MCP servers:', mcpData.data?.map((s: MCPServer) => ({ id: s.id, name: s.name, workspace_id: s.workspace_id })));
        console.log('🔍 Debug - Buds with MCP config:', workspaceBuds.map(b => ({ 
          id: b.id, 
          name: getBudConfig(b).name,
          mcpConfig: getBudConfig(b).mcpConfig 
        })));

      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workspace data');
      } finally {
        setLoading(false);
      }
    };
    
    loadWorkspaceData();
  }, [workspaceId]);

  // Bud management functions
  const startEditingBud = (budId: string) => {
    setBuds(prev => prev.map(bud => 
      bud.id === budId 
        ? { ...bud, isEditing: true, editConfig: getBudConfig(bud) }
        : { ...bud, isEditing: false }
    ));
  };

  const cancelEditingBud = (budId: string) => {
    setBuds(prev => prev.map(bud => 
      bud.id === budId 
        ? { ...bud, isEditing: false, editConfig: getBudConfig(bud) }
        : bud
    ));
  };

  const saveBudChanges = async (budId: string) => {
    const bud = buds.find(b => b.id === budId);
    if (!bud) return;

    try {
      setSaving(budId);
      await budManager.updateBud(budId, { config: bud.editConfig });
      
      setBuds(prev => prev.map(b => 
        b.id === budId 
          ? { ...b, isEditing: false, default_json: bud.editConfig }
          : b
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save bud');
    } finally {
      setSaving(null);
    }
  };

  const createNewBud = async () => {
    if (!newBudConfig.name || !newBudConfig.systemPrompt) {
      setError('Name and system prompt are required');
      return;
    }

    try {
      setSaving('new-bud');
      const newBud = await budManager.createBud({
        name: newBudConfig.name,
        config: newBudConfig as BudConfig,
        workspaceId
      });

      setBuds(prev => [...prev, {
        ...newBud,
        isEditing: false,
        editConfig: getBudConfig(newBud)
      }]);

      setNewBudConfig({
        name: '',
        systemPrompt: 'You are a helpful, harmless, and honest AI assistant.',
        model: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 2048,
        avatar: '🤖'
      });
      setShowNewBudDialog(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bud');
    } finally {
      setSaving(null);
    }
  };

  const deleteBud = async (budId: string) => {
    if (!confirm('Are you sure you want to delete this bud?')) return;

    try {
      await budManager.deleteBud(budId);
      setBuds(prev => prev.filter(b => b.id !== budId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete bud');
    }
  };

  // MCP server management functions
  const createMCPServer = async () => {
    if (!newMCPServer.name || !newMCPServer.endpoint) {
      setError('Name and endpoint are required');
      return;
    }

    try {
      setSaving('new-mcp');
      const response = await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newMCPServer,
          workspaceId,
          auth_config: newMCPServer.auth_config ? JSON.parse(newMCPServer.auth_config) : null
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create MCP server');
      }

      const data = await response.json();
      setMcpServers(prev => [...prev, data.data]);
      
      setNewMCPServer({
        name: '',
        endpoint: '',
        transport_type: 'http',
        auth_config: '',
        is_active: true
      });
      setShowNewMCPDialog(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create MCP server');
    } finally {
      setSaving(null);
    }
  };

  const testMCPServer = async (serverId: string) => {
    try {
      setTestingServer(serverId);
      const response = await fetch(`/api/mcp/servers/${serverId}/test`, {
        method: 'POST'
      });

      const data = await response.json();
      if (response.ok) {
        alert(`MCP Server test successful!\nTools: ${data.tools?.length || 0}\nCapabilities: ${JSON.stringify(data.capabilities, null, 2)}`);
      } else {
        alert(`MCP Server test failed: ${data.error}`);
      }
    } catch (err) {
      alert(`MCP Server test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTestingServer(null);
    }
  };

  const updateMCPServer = async (serverId: string, updates: Partial<MCPServer>) => {
    try {
      setSaving(serverId);
      
      // Process auth_config if there's a raw string
      const processedUpdates = { ...updates };
      const updatesWithRaw = updates as Partial<MCPServer> & { auth_config_raw?: string };
      const rawAuthConfig = updatesWithRaw.auth_config_raw;
      if (rawAuthConfig !== undefined) {
        if (rawAuthConfig.trim() === '') {
          processedUpdates.auth_config = null;
        } else {
          try {
            processedUpdates.auth_config = JSON.parse(rawAuthConfig);
          } catch (_) {
            throw new Error('Invalid JSON in auth config');
          }
        }
        // Remove the raw field before sending to API
        const { auth_config_raw: _, ...cleanUpdates } = processedUpdates as typeof processedUpdates & { auth_config_raw?: string };
        Object.assign(processedUpdates, cleanUpdates);
      }
      
      const response = await fetch(`/api/mcp/servers/${serverId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(processedUpdates)
      });

      if (!response.ok) {
        throw new Error('Failed to update MCP server');
      }

      const data = await response.json();
      setMcpServers(prev => prev.map(s => s.id === serverId ? data.data : s));
      setEditingMCPServer(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update MCP server');
    } finally {
      setSaving(null);
    }
  };

  const deleteMCPServer = async (serverId: string) => {
    if (!confirm('Are you sure you want to delete this MCP server?')) return;

    try {
      const response = await fetch(`/api/mcp/servers/${serverId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete MCP server');
      }

      setMcpServers(prev => prev.filter(s => s.id !== serverId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete MCP server');
    }
  };

  // Update bud edit config
  const updateBudEditConfig = (budId: string, field: keyof BudConfig, value: unknown) => {
    setBuds(prev => prev.map(bud => 
      bud.id === budId 
        ? { ...bud, editConfig: { ...bud.editConfig, [field]: value } }
        : bud
    ));
  };

  // Add/remove foundation model-managed MCP server from bud
  const addRemoteMCPToBud = (budId: string, preset?: { label: string; url: string }) => {
    const newRemoteServer: RemoteMCPConfig = {
      server_label: preset?.label || '',
      server_url: preset?.url || '',
      require_approval: 'never'
    };

    updateBudEditConfig(budId, 'mcpConfig', {
      ...buds.find(b => b.id === budId)?.editConfig.mcpConfig,
      remote_servers: [
        ...(buds.find(b => b.id === budId)?.editConfig.mcpConfig?.remote_servers || []),
        newRemoteServer
      ]
    });
  };

  const updateRemoteMCPServer = (budId: string, index: number, field: keyof RemoteMCPConfig, value: unknown) => {
    const bud = buds.find(b => b.id === budId);
    if (!bud) return;

    const remoteServers = [...(bud.editConfig.mcpConfig?.remote_servers || [])];
    remoteServers[index] = { ...remoteServers[index], [field]: value };

    updateBudEditConfig(budId, 'mcpConfig', {
      ...bud.editConfig.mcpConfig,
      remote_servers: remoteServers
    });
  };

  const removeRemoteMCPServer = (budId: string, index: number) => {
    const bud = buds.find(b => b.id === budId);
    if (!bud) return;

    const remoteServers = [...(bud.editConfig.mcpConfig?.remote_servers || [])];
    remoteServers.splice(index, 1);

    updateBudEditConfig(budId, 'mcpConfig', {
      ...bud.editConfig.mcpConfig,
      remote_servers: remoteServers
    });
  };

  const removeApplicationMCPServer = (budId: string, serverId: string) => {
    const bud = buds.find(b => b.id === budId);
    if (!bud) return;

    const servers = [...(bud.editConfig.mcpConfig?.servers || [])];
    const filteredServers = servers.filter(id => id !== serverId);

    updateBudEditConfig(budId, 'mcpConfig', {
      ...bud.editConfig.mcpConfig,
      servers: filteredServers
    });
  };

  const addApplicationMCPToBud = (budId: string) => {
    // For now, show a simple dialog to select from available MCP servers
    // This could be enhanced with a multi-select dialog in the future
    const availableServers = mcpServers.filter(server => {
      const bud = buds.find(b => b.id === budId);
      const currentServers = bud?.editConfig.mcpConfig?.servers || [];
      return !currentServers.includes(server.id);
    });

    if (availableServers.length === 0) {
      alert('No available MCP servers to add. Create MCP servers first in the MCP Servers section above.');
      return;
    }

    // Show a simple prompt for now - could be enhanced with a proper dialog
    const serverNames = availableServers.map((s, i) => `${i + 1}. ${s.name} (${s.endpoint})`).join('\n');
    const choice = prompt(`Select MCP Server to add:\n\n${serverNames}\n\nEnter the number (1-${availableServers.length}):`);
    
    if (choice) {
      const index = parseInt(choice) - 1;
      if (index >= 0 && index < availableServers.length) {
        const selectedServer = availableServers[index];
        const bud = buds.find(b => b.id === budId);
        
        updateBudEditConfig(budId, 'mcpConfig', {
          ...bud?.editConfig.mcpConfig,
          servers: [...(bud?.editConfig.mcpConfig?.servers || []), selectedServer.id]
        });
      }
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/')}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Workspace
            </Button>
          </div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Settings className="h-8 w-8 text-primary" />
            Workspace Settings
          </h1>
          <p className="text-muted-foreground">Manage your buds and MCP servers</p>
        </div>
      </div>

      {error && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>
            <X className="h-4 w-4" />
          </Button>
        </Alert>
      )}

      <Tabs defaultValue="buds" className="space-y-6">
        <TabsList>
          <TabsTrigger value="buds">Buds ({buds.length})</TabsTrigger>
          <TabsTrigger value="mcp-servers">MCP Servers ({mcpServers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="buds" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Manage Buds</h2>
            <Dialog open={showNewBudDialog} onOpenChange={setShowNewBudDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  New Bud
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create New Bud</DialogTitle>
                  <DialogDescription>Configure a new AI assistant</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="name">Name</Label>
                      <Input
                        id="name"
                        value={newBudConfig.name || ''}
                        onChange={(e) => setNewBudConfig(prev => ({ ...prev, name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="avatar">Avatar</Label>
                      <Input
                        id="avatar"
                        value={newBudConfig.avatar || ''}
                        onChange={(e) => setNewBudConfig(prev => ({ ...prev, avatar: e.target.value }))}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="systemPrompt">System Prompt</Label>
                    <Textarea
                      id="systemPrompt"
                      rows={4}
                      value={newBudConfig.systemPrompt || ''}
                      onChange={(e) => setNewBudConfig(prev => ({ ...prev, systemPrompt: e.target.value }))}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="model">Model</Label>
                      <Select value={newBudConfig.model} onValueChange={(value) => setNewBudConfig(prev => ({ ...prev, model: value }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {models.map(model => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="temperature">Temperature</Label>
                      <Input
                        id="temperature"
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        value={newBudConfig.temperature || 0.7}
                        onChange={(e) => setNewBudConfig(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="maxTokens">Max Tokens</Label>
                      <Input
                        id="maxTokens"
                        type="number"
                        min="1"
                        max="32000"
                        value={newBudConfig.maxTokens || 2048}
                        onChange={(e) => setNewBudConfig(prev => ({ ...prev, maxTokens: parseInt(e.target.value) }))}
                      />
                    </div>
                  </div>
                </div>
                
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowNewBudDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={createNewBud} disabled={saving === 'new-bud'}>
                    {saving === 'new-bud' ? 'Creating...' : 'Create Bud'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4">
            {buds.map((bud) => (
              <Card key={bud.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{getBudAvatar(bud)}</span>
                      <div>
                        <CardTitle>{getBudDisplayName(bud)}</CardTitle>
                        <CardDescription>
                          Model: {getBudModel(bud)} • Created: {new Date(bud.created_at).toLocaleDateString()}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {bud.isEditing ? (
                        <>
                          <Button size="sm" onClick={() => saveBudChanges(bud.id)} disabled={saving === bud.id}>
                            <Save className="h-4 w-4 mr-1" />
                            {saving === bud.id ? 'Saving...' : 'Save'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => cancelEditingBud(bud.id)}>
                            <X className="h-4 w-4 mr-1" />
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => startEditingBud(bud.id)}>
                            <Edit className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => deleteBud(bud.id)}>
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>
                
                {bud.isEditing && (
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Name</Label>
                        <Input
                          value={bud.editConfig.name}
                          onChange={(e) => updateBudEditConfig(bud.id, 'name', e.target.value)}
                        />
                      </div>
                      <div>
                        <Label>Avatar</Label>
                        <Input
                          value={bud.editConfig.avatar || ''}
                          onChange={(e) => updateBudEditConfig(bud.id, 'avatar', e.target.value)}
                        />
                      </div>
                    </div>
                    
                    <div>
                      <Label>System Prompt</Label>
                      <Textarea
                        rows={4}
                        value={bud.editConfig.systemPrompt}
                        onChange={(e) => updateBudEditConfig(bud.id, 'systemPrompt', e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label>Model</Label>
                        <Select value={bud.editConfig.model} onValueChange={(value) => updateBudEditConfig(bud.id, 'model', value)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {models.map(model => (
                              <SelectItem key={model.value} value={model.value}>
                                {model.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Temperature</Label>
                        <Input
                          type="number"
                          min="0"
                          max="1"
                          step="0.1"
                          value={bud.editConfig.temperature || 0.7}
                          onChange={(e) => updateBudEditConfig(bud.id, 'temperature', parseFloat(e.target.value))}
                        />
                      </div>
                      <div>
                        <Label>Max Tokens</Label>
                        <Input
                          type="number"
                          min="1"
                          max="32000"
                          value={bud.editConfig.maxTokens || 2048}
                          onChange={(e) => updateBudEditConfig(bud.id, 'maxTokens', parseInt(e.target.value))}
                        />
                      </div>
                    </div>

                    <Separator />
                    
                    {/* Application-Managed MCP Servers Section */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">Application-Managed MCP Servers</h4>
                          <p className="text-sm text-muted-foreground">MCP servers called directly by this application</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => addApplicationMCPToBud(bud.id)}>
                          <Plus className="h-4 w-4 mr-1" />
                          Add Server
                        </Button>
                      </div>
                      
                      {bud.editConfig.mcpConfig?.servers && bud.editConfig.mcpConfig.servers.length > 0 ? (
                        <div className="space-y-2">
                          {bud.editConfig.mcpConfig.servers.map((serverId, index) => {
                            const server = mcpServers.find(s => s.id === serverId);
                            return (
                              <Card key={serverId} className="p-3">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="font-medium">{server?.name || `Server ${index + 1}`}</div>
                                    <div className="text-sm text-muted-foreground">{server?.endpoint || 'Unknown endpoint'}</div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant={server?.is_active ? "default" : "secondary"}>
                                      {server?.is_active ? "Active" : "Inactive"}
                                    </Badge>
                                    <Button 
                                      size="sm" 
                                      variant="outline" 
                                      onClick={() => removeApplicationMCPServer(bud.id, serverId)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              </Card>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-sm">No application-managed MCP servers configured</p>
                      )}
                    </div>

                    <Separator />
                    
                    {/* Foundation Model-Managed MCP Servers Section */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">Foundation Model-Managed MCP Servers</h4>
                          <p className="text-sm text-muted-foreground">HTTP addressable MCP servers called directly by the foundation model API</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => addRemoteMCPToBud(bud.id)}>
                          <Plus className="h-4 w-4 mr-1" />
                          Add HTTP MCP Server
                        </Button>
                      </div>
                      
                      {(!bud.editConfig.mcpConfig?.remote_servers || bud.editConfig.mcpConfig.remote_servers.length === 0) && (
                        <Card className="p-4 bg-muted/50">
                          <h5 className="font-medium mb-2">Available HTTP Addressable MCP Servers:</h5>
                          <div className="space-y-2 text-sm">
                            <div className="flex items-center justify-between">
                              <div>
                                <strong>DeepWiki:</strong> Access Wikipedia and other knowledge sources
                                <br />
                                <code className="text-xs bg-background px-1 py-0.5 rounded">https://mcp.deepwiki.com/mcp</code>
                              </div>
                              <Button size="sm" variant="outline" onClick={() => addRemoteMCPToBud(bud.id, { label: 'deepwiki', url: 'https://mcp.deepwiki.com/mcp' })}>
                                Add
                              </Button>
                            </div>
                            <div className="flex items-center justify-between">
                              <div>
                                <strong>Stripe:</strong> Stripe payment platform integration  
                                <br />
                                <code className="text-xs bg-background px-1 py-0.5 rounded">https://mcp.stripe.com/mcp</code>
                              </div>
                              <Button size="sm" variant="outline" onClick={() => addRemoteMCPToBud(bud.id, { label: 'stripe', url: 'https://mcp.stripe.com/mcp' })}>
                                Add
                              </Button>
                            </div>
                            <div className="flex items-center justify-between">
                              <div>
                                <strong>Shopify:</strong> Shopify e-commerce platform integration
                                <br />
                                <code className="text-xs bg-background px-1 py-0.5 rounded">https://mcp.shopify.com/mcp</code>
                              </div>
                              <Button size="sm" variant="outline" onClick={() => addRemoteMCPToBud(bud.id, { label: 'shopify', url: 'https://mcp.shopify.com/mcp' })}>
                                Add
                              </Button>
                            </div>
                          </div>
                        </Card>
                      )}
                      
                      {bud.editConfig.mcpConfig?.remote_servers?.map((server, index) => (
                        <Card key={index} className="p-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h5 className="font-medium">Remote MCP Server {index + 1}</h5>
                              <Button size="sm" variant="destructive" onClick={() => removeRemoteMCPServer(bud.id, index)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label>Server Label</Label>
                                <Input
                                  placeholder="e.g., deepwiki"
                                  value={server.server_label}
                                  onChange={(e) => updateRemoteMCPServer(bud.id, index, 'server_label', e.target.value)}
                                />
                              </div>
                              <div>
                                <Label>Server URL</Label>
                                <Input
                                  placeholder="e.g., https://mcp.deepwiki.com/mcp"
                                  value={server.server_url}
                                  onChange={(e) => updateRemoteMCPServer(bud.id, index, 'server_url', e.target.value)}
                                />
                              </div>
                            </div>
                            
                            <div>
                              <Label>Approval Required</Label>
                              <Select 
                                value={server.require_approval as string} 
                                onValueChange={(value) => updateRemoteMCPServer(bud.id, index, 'require_approval', value)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="never">Never</SelectItem>
                                  <SelectItem value="always">Always</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </Card>
                      ))}
                      
                      {(!bud.editConfig.mcpConfig?.remote_servers || bud.editConfig.mcpConfig.remote_servers.length === 0) && (
                        <div className="space-y-2">
                          <p className="text-muted-foreground text-sm">No foundation model-managed MCP servers configured</p>
                          {bud.editConfig.mcpConfig?.servers && bud.editConfig.mcpConfig.servers.length > 0 && (
                            <p className="text-muted-foreground text-xs">
                              Note: This bud has {bud.editConfig.mcpConfig.servers.length} application-managed MCP server(s) configured
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="mcp-servers" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold">MCP Servers</h2>
              <p className="text-muted-foreground">Application-managed MCP servers that this application calls directly</p>
            </div>
            <Dialog open={showNewMCPDialog} onOpenChange={setShowNewMCPDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  New MCP Server
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New MCP Server</DialogTitle>
                  <DialogDescription>Configure a new Model Context Protocol server</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div>
                    <Label htmlFor="mcp-name">Name</Label>
                    <Input
                      id="mcp-name"
                      value={newMCPServer.name}
                      onChange={(e) => setNewMCPServer(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="mcp-endpoint">Endpoint</Label>
                    <Input
                      id="mcp-endpoint"
                      value={newMCPServer.endpoint}
                      onChange={(e) => setNewMCPServer(prev => ({ ...prev, endpoint: e.target.value }))}
                    />
                  </div>

                  <div>
                    <Label htmlFor="mcp-transport">Transport Type</Label>
                    <Select value={newMCPServer.transport_type} onValueChange={(value) => setNewMCPServer(prev => ({ ...prev, transport_type: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="http">HTTP</SelectItem>
                        <SelectItem value="websocket">WebSocket</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="mcp-auth">Auth Config (JSON)</Label>
                    <Textarea
                      id="mcp-auth"
                      placeholder='{"type": "bearer", "token": "..."}'
                      value={newMCPServer.auth_config}
                      onChange={(e) => setNewMCPServer(prev => ({ ...prev, auth_config: e.target.value }))}
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={newMCPServer.is_active}
                      onCheckedChange={(checked) => setNewMCPServer(prev => ({ ...prev, is_active: checked }))}
                    />
                    <Label>Active</Label>
                  </div>
                </div>
                
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowNewMCPDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={createMCPServer} disabled={saving === 'new-mcp'}>
                    {saving === 'new-mcp' ? 'Creating...' : 'Create Server'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Edit MCP Server Dialog */}
            <Dialog open={!!editingMCPServer} onOpenChange={(open) => !open && setEditingMCPServer(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit MCP Server</DialogTitle>
                  <DialogDescription>Update the MCP server configuration</DialogDescription>
                </DialogHeader>
                {editingMCPServer && (
                  <div className="grid gap-4 py-4">
                    <div>
                      <Label htmlFor="edit-mcp-name">Name</Label>
                      <Input
                        id="edit-mcp-name"
                        value={editingMCPServer.name}
                        onChange={(e) => setEditingMCPServer(prev => prev ? { ...prev, name: e.target.value } : null)}
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="edit-mcp-endpoint">Endpoint</Label>
                      <Input
                        id="edit-mcp-endpoint"
                        value={editingMCPServer.endpoint}
                        onChange={(e) => setEditingMCPServer(prev => prev ? { ...prev, endpoint: e.target.value } : null)}
                      />
                    </div>

                    <div>
                      <Label htmlFor="edit-mcp-transport">Transport Type</Label>
                      <Select 
                        value={editingMCPServer.transport_type} 
                        onValueChange={(value) => setEditingMCPServer(prev => prev ? { ...prev, transport_type: value } : null)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="http">HTTP</SelectItem>
                          <SelectItem value="websocket">WebSocket</SelectItem>
                          <SelectItem value="stdio">STDIO</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="edit-mcp-auth">Auth Config (JSON)</Label>
                      <Textarea
                        id="edit-mcp-auth"
                        placeholder='{"type": "bearer", "token": "..."}'
                        value={(editingMCPServer as MCPServer & { auth_config_raw?: string }).auth_config_raw || (editingMCPServer.auth_config ? JSON.stringify(editingMCPServer.auth_config, null, 2) : '')}
                        onChange={(e) => {
                          const value = e.target.value;
                          setEditingMCPServer(prev => {
                            if (!prev) return null;
                            return { ...prev, auth_config_raw: value } as MCPServer & { auth_config_raw?: string };
                          });
                        }}
                      />
                    </div>

                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={editingMCPServer.is_active ?? true}
                        onCheckedChange={(checked) => setEditingMCPServer(prev => prev ? { ...prev, is_active: checked } : null)}
                      />
                      <Label>Active</Label>
                    </div>
                  </div>
                )}
                
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditingMCPServer(null)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => editingMCPServer && updateMCPServer(editingMCPServer.id, editingMCPServer)} 
                    disabled={saving === editingMCPServer?.id}
                  >
                    {saving === editingMCPServer?.id ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Transport</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mcpServers.map((server) => (
                  <TableRow key={server.id}>
                    <TableCell className="font-medium">{server.name}</TableCell>
                    <TableCell className="font-mono text-sm">{server.endpoint}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{server.transport_type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={server.is_active ? "default" : "secondary"}>
                        {server.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {server.created_at ? new Date(server.created_at).toLocaleDateString() : 'N/A'}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <Settings className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditingMCPServer(server)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => testMCPServer(server.id)} disabled={testingServer === server.id}>
                            <TestTube className="h-4 w-4 mr-2" />
                            {testingServer === server.id ? 'Testing...' : 'Test Connection'}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => deleteMCPServer(server.id)}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {mcpServers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No MCP servers configured
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}