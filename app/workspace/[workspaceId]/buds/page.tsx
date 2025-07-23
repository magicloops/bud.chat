'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Search, 
  Plus, 
  Settings, 
  Copy, 
  Edit, 
  Trash2, 
  ArrowLeft,
  Filter,
  RefreshCw,
  Users,
  Bot
} from 'lucide-react';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BudForm } from '@/components/BudForm';
import { 
  useWorkspaceBuds, 
  useWorkspaceBudsLoading, 
  useWorkspaceBudsError,
  useLoadWorkspaceBuds,
  useCreateBud,
  useBudCreateLoading,
  useUpdateBud,
  useDeleteBud
} from '@/state/budStore';
import { Bud, BudConfig } from '@/lib/types';
import { getBudConfig, getBudDisplayName, getBudAvatar, getBudModel } from '@/lib/budHelpers';

interface BudsManagementPageProps {
  params: Promise<{ workspaceId: string }>
}

export default function BudsManagementPage({ params }: BudsManagementPageProps) {
  const router = useRouter();
  const { workspaceId } = use(params);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingBud, setEditingBud] = useState<Bud | null>(null);
  
  // State management
  const buds = useWorkspaceBuds(workspaceId);
  const loading = useWorkspaceBudsLoading(workspaceId);
  const error = useWorkspaceBudsError(workspaceId);
  const loadWorkspaceBuds = useLoadWorkspaceBuds();
  const createBud = useCreateBud();
  const createLoading = useBudCreateLoading();
  const updateBud = useUpdateBud();
  const deleteBud = useDeleteBud();

  // Load buds on mount
  useEffect(() => {
    loadWorkspaceBuds(workspaceId);
  }, [workspaceId, loadWorkspaceBuds]);

  // Filter buds based on search and model
  const filteredBuds = buds.filter(bud => {
    const config = getBudConfig(bud as unknown as Bud);
    const matchesSearch = !searchQuery || 
      config.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      config.systemPrompt.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesModel = !selectedModel || config.model === selectedModel;
    
    return matchesSearch && matchesModel;
  });

  // Get unique models for filter
  const availableModels = [...new Set(buds.map(bud => getBudModel(bud as unknown as Bud)))];

  const handleCreateBud = async (config: BudConfig, name: string) => {
    await createBud({
      name,
      config,
      workspaceId
    });
    // No need to reload - store automatically updates
  };

  const handleEditBud = async (config: BudConfig, name: string) => {
    if (!editingBud) return;
    
    await updateBud(editingBud.id, {
      name,
      config
    });
    // No need to reload - store automatically updates
    setEditingBud(null);
  };

  const handleDuplicateBud = async (bud: Bud) => {
    const config = getBudConfig(bud);
    const newConfig = {
      ...config,
      name: `${config.name} (Copy)`
    };
    
    await createBud({
      name: newConfig.name,
      config: newConfig,
      workspaceId
    });
    // No need to reload - store automatically updates
  };

  const handleDeleteBud = async (budId: string) => {
    if (confirm('Are you sure you want to delete this bud? This action cannot be undone.')) {
      await deleteBud(budId);
    }
  };

  const handleRefresh = () => {
    loadWorkspaceBuds(workspaceId);
  };

  const handleStartChat = (budId: string) => {
    router.push(`/new?bud=${budId}`);
  };

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex flex-col items-center justify-center h-64">
          <div className="text-center max-w-md">
            <p className="text-destructive mb-4">Failed to load buds: {error}</p>
            <Button onClick={handleRefresh} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
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
            Manage Buds
          </h1>
          <p className="text-muted-foreground">
            Create, edit, and organize your AI assistants for this workspace.
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button onClick={handleRefresh} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Bud
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Buds</CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{buds.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AI Models</CardTitle>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{availableModels.length}</div>
            <p className="text-xs text-muted-foreground">
              {availableModels.slice(0, 2).join(', ')}
              {availableModels.length > 2 && ` +${availableModels.length - 2}`}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Workspace Access</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">All Members</div>
            <p className="text-xs text-muted-foreground">
              Shared across workspace
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Bud Library</CardTitle>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{buds.length} total</span>
              {searchQuery && <span>{filteredBuds.length} filtered</span>}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search buds by name or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="px-3 py-2 border rounded-md bg-background text-sm min-w-[120px]"
              >
                <option value="">All Models</option>
                {availableModels.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Bud Table */}
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredBuds.length === 0 ? (
            <div className="text-center py-8">
              <Bot className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">
                {buds.length === 0 ? 'No Buds Yet' : 'No Buds Found'}
              </h3>
              <p className="text-muted-foreground mb-4">
                {buds.length === 0 
                  ? 'Create your first bud to get started.' 
                  : 'Try adjusting your search or filters.'}
              </p>
              <Button onClick={() => setShowCreateForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Bud
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bud</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Temperature</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBuds.map((bud) => {
                  const config = getBudConfig(bud as unknown as Bud);
                  const displayName = getBudDisplayName(bud as unknown as Bud);
                  const avatar = getBudAvatar(bud as unknown as Bud);
                  const model = getBudModel(bud as unknown as Bud);
                  
                  return (
                    <TableRow key={bud.id} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{avatar}</span>
                          <div>
                            <div className="font-medium">{displayName}</div>
                            <div className="text-sm text-muted-foreground line-clamp-1">
                              {config.systemPrompt.slice(0, 60)}...
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{model}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {config.temperature || 0.7}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(bud.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              Actions
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleStartChat(bud.id)}>
                              <Bot className="h-4 w-4 mr-2" />
                              Start Chat
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditingBud(bud as unknown as Bud)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicateBud(bud as unknown as Bud)}>
                              <Copy className="h-4 w-4 mr-2" />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleDeleteBud(bud.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Bud Form */}
      <BudForm
        workspaceId={workspaceId}
        open={showCreateForm}
        onClose={() => setShowCreateForm(false)}
        onSave={handleCreateBud}
        loading={createLoading}
      />

      {/* Edit Bud Form */}
      <BudForm
        bud={editingBud || undefined}
        workspaceId={workspaceId}
        open={!!editingBud}
        onClose={() => setEditingBud(null)}
        onSave={handleEditBud}
        loading={false}
      />
    </div>
  );
}