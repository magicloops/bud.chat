'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Sparkles, Filter } from 'lucide-react';
import { BudCard } from './BudCard';
import { CreateBudCard } from './CreateBudCard';
import { BudForm } from './BudForm';
import { 
  useWorkspaceBuds, 
  useWorkspaceBudsLoading, 
  useWorkspaceBudsError,
  useLoadWorkspaceBuds,
  useCreateBud,
  useBudCreateLoading,
  useDeleteBud
} from '@/state/budStore';
import { BudConfig } from '@/lib/types';

interface BudSelectionGridProps {
  workspaceId: string
}

export function BudSelectionGrid({ workspaceId }: BudSelectionGridProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('');
  
  // State management
  const buds = useWorkspaceBuds(workspaceId);
  const loading = useWorkspaceBudsLoading(workspaceId);
  const error = useWorkspaceBudsError(workspaceId);
  const loadWorkspaceBuds = useLoadWorkspaceBuds();
  const createBud = useCreateBud();
  const createLoading = useBudCreateLoading();
  const deleteBud = useDeleteBud();

  // Load buds on mount
  useEffect(() => {
    loadWorkspaceBuds(workspaceId);
  }, [workspaceId, loadWorkspaceBuds]);

  // Filter buds based on search and model
  const filteredBuds = buds.filter(bud => {
    const config = bud.default_json as BudConfig;
    const matchesSearch = !searchQuery || 
      config.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      config.systemPrompt.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesModel = !selectedModel || config.model === selectedModel;
    
    return matchesSearch && matchesModel;
  });

  // Get unique models for filter
  const availableModels = [...new Set(buds.map(bud => (bud.default_json as BudConfig).model))];

  const handleBudSelect = (budId: string) => {
    router.push(`/new?bud=${budId}`);
  };

  const handleCreateBud = async (config: BudConfig, name: string) => {
    await createBud({
      name,
      config,
      workspaceId
    });
    // No need to reload - the store automatically updates buds list
  };

  const handleDeleteBud = async (budId: string) => {
    if (confirm('Are you sure you want to delete this bud?')) {
      await deleteBud(budId);
    }
  };


  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <div className="text-center max-w-md">
          <p className="text-destructive mb-4">Failed to load buds: {error}</p>
          <p className="text-sm text-muted-foreground">Try reloading the page</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 border-b bg-background/95 backdrop-blur">
        {/* Title and Stats Row */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              Choose Your Bud
            </h1>
            <p className="text-muted-foreground mt-1">
              Select an AI assistant to start a conversation, or create a new one.
            </p>
          </div>
          
          {/* Stats on the right */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{buds.length} total buds</span>
            {searchQuery && (
              <span>{filteredBuds.length} matching search</span>
            )}
            {selectedModel && (
              <Badge variant="secondary" className="text-xs">
                {selectedModel}
              </Badge>
            )}
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex gap-4">
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
              className="px-3 py-2 border rounded-md bg-background text-sm"
            >
              <option value="">All Models</option>
              {availableModels.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Grid Content */}
      <div className="flex-1 min-h-0 p-6 overflow-y-auto">
        {loading ? (
          // Loading skeletons
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        ) : filteredBuds.length === 0 && buds.length === 0 ? (
          // Empty state - no buds at all
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="max-w-md">
              <Sparkles className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h2 className="text-xl font-semibold mb-2">Create Your First Bud</h2>
              <p className="text-muted-foreground mb-6">
                Buds are customizable AI assistants. Create one to get started with personalized conversations.
              </p>
              <Button onClick={() => setShowCreateForm(true)} size="lg">
                Create Your First Bud
              </Button>
            </div>
          </div>
        ) : filteredBuds.length === 0 ? (
          // Empty state - no search results
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="max-w-md">
              <Search className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h2 className="text-xl font-semibold mb-2">No Buds Found</h2>
              <p className="text-muted-foreground mb-6">
                Try adjusting your search terms or create a new bud.
              </p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" onClick={() => {
                  setSearchQuery('');
                  setSelectedModel('');
                }}>
                  Clear Filters
                </Button>
                <Button onClick={() => setShowCreateForm(true)}>
                  Create New Bud
                </Button>
              </div>
            </div>
          </div>
        ) : (
          // Bud grid
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* Create new bud card */}
            <CreateBudCard onClick={() => setShowCreateForm(true)} />
            
            {/* Existing buds */}
            {filteredBuds.map((bud) => (
              <BudCard
                key={bud.id}
                bud={bud}
                onClick={() => handleBudSelect(bud.id)}
                onDelete={() => handleDeleteBud(bud.id)}
                showActions={true}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Bud Form */}
      <BudForm
        workspaceId={workspaceId}
        open={showCreateForm}
        onClose={() => setShowCreateForm(false)}
        onSave={handleCreateBud}
        loading={createLoading}
      />
    </div>
  );
}