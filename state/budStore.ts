import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { Database } from '@/lib/types/database';
import { useMemo } from 'react';
import { Bud } from '@/lib/types';
import { budManager, CreateBudArgs, UpdateBudArgs } from '@/lib/budHelpers';

// Simplified type for store to avoid infinite type recursion
interface BudForStore {
  id: string;
  owner_user_id: string | null;
  workspace_id: string | null;
  name: string;
  default_json: Database['public']['Tables']['buds']['Row']['default_json'];
  mcp_config: Database['public']['Tables']['buds']['Row']['mcp_config'];
  builtin_tools_config: Database['public']['Tables']['buds']['Row']['builtin_tools_config'];
  created_at: string | null;
}

export interface BudStore {
  // Core data
  buds: Record<string, BudForStore>             // budId -> BudForStore
  workspaceBuds: Record<string, string[]>        // workspaceId -> budIds[]
  
  // Loading states
  loading: {
    workspace: Record<string, boolean>           // workspaceId -> loading
    create: boolean
    update: Record<string, boolean>              // budId -> loading
    delete: Record<string, boolean>              // budId -> loading
  }
  
  // Error states
  errors: {
    workspace: Record<string, string | null>     // workspaceId -> error
    create: string | null
    update: Record<string, string | null>        // budId -> error
    delete: Record<string, string | null>        // budId -> error
  }
  
  // Actions
  loadWorkspaceBuds: (workspaceId: string) => Promise<void>
  createBud: (args: CreateBudArgs) => Promise<Bud>
  updateBud: (budId: string, updates: UpdateBudArgs) => Promise<Bud>
  deleteBud: (budId: string) => Promise<void>
  getBud: (budId: string) => Bud | undefined
  getWorkspaceBuds: (workspaceId: string) => Bud[]
  
  // Utility actions
  clearErrors: () => void
  clearWorkspaceError: (workspaceId: string) => void
  clearBudError: (budId: string, type: 'update' | 'delete') => void
}

export const useBudStore = create<BudStore>()(
  subscribeWithSelector(
    immer((set, get) => ({
        // Initial state
        buds: {},
        workspaceBuds: {},
        loading: {
          workspace: {},
          create: false,
          update: {},
          delete: {}
        },
        errors: {
          workspace: {},
          create: null,
          update: {},
          delete: {}
        },
        
        // Load workspace buds - always fetch fresh data
        loadWorkspaceBuds: async (workspaceId: string) => {
          const currentState = get();
          
          // Skip if already loading to prevent duplicate requests
          if (currentState.loading.workspace[workspaceId]) {
            return;
          }
          
          set((state) => {
            state.loading.workspace[workspaceId] = true;
            state.errors.workspace[workspaceId] = null;
          });
          
          try {
            const buds = await budManager.getWorkspaceBuds(workspaceId);
            
            set((state) => {
              // Store buds by id
              buds.forEach(bud => {
                state.buds[bud.id] = bud;
              });
              
              // Store workspace -> bud ids mapping
              state.workspaceBuds[workspaceId] = buds.map(b => b.id);
              state.loading.workspace[workspaceId] = false;
            });
          } catch (error) {
            set((state) => {
              state.loading.workspace[workspaceId] = false;
              state.errors.workspace[workspaceId] = error instanceof Error ? error.message : 'Failed to load buds';
            });
          }
        },
        
        // Create new bud
        createBud: async (args: CreateBudArgs) => {
          set((state) => {
            state.loading.create = true;
            state.errors.create = null;
          });
          
          try {
            const newBud = await budManager.createBud(args);
            
            set((state) => {
              // Add to buds collection
              // @ts-expect-error - Complex type mapping between Bud and BudForStore with Json type
              state.buds[newBud.id] = newBud;
              
              // Add to workspace buds list
              if (!state.workspaceBuds[args.workspaceId]) {
                state.workspaceBuds[args.workspaceId] = [];
              }
              state.workspaceBuds[args.workspaceId].unshift(newBud.id); // Add to beginning
              
              state.loading.create = false;
            });
            
            return newBud;
          } catch (error) {
            set((state) => {
              state.loading.create = false;
              state.errors.create = error instanceof Error ? error.message : 'Failed to create bud';
            });
            throw error;
          }
        },
        
        // Update bud
        updateBud: async (budId: string, updates: UpdateBudArgs) => {
          set((state) => {
            state.loading.update[budId] = true;
            state.errors.update[budId] = null;
          });
          
          try {
            const updatedBud = await budManager.updateBud(budId, updates);
            
            set((state) => {
              state.buds[budId] = updatedBud as unknown as BudForStore;
              state.loading.update[budId] = false;
            });
            
            return updatedBud;
          } catch (error) {
            set((state) => {
              state.loading.update[budId] = false;
              state.errors.update[budId] = error instanceof Error ? error.message : 'Failed to update bud';
            });
            throw error;
          }
        },
        
        // Delete bud
        deleteBud: async (budId: string) => {
          const bud = get().buds[budId];
          if (!bud) return;
          
          set((state) => {
            state.loading.delete[budId] = true;
            state.errors.delete[budId] = null;
          });
          
          try {
            await budManager.deleteBud(budId);
            
            set((state) => {
              // Remove from buds collection
              delete state.buds[budId];
              
              // Remove from workspace buds lists
              Object.keys(state.workspaceBuds).forEach(workspaceId => {
                state.workspaceBuds[workspaceId] = state.workspaceBuds[workspaceId]
                  .filter(id => id !== budId);
              });
              
              // Clean up loading and error states
              delete state.loading.update[budId];
              delete state.loading.delete[budId];
              delete state.errors.update[budId];
              delete state.errors.delete[budId];
            });
          } catch (error) {
            set((state) => {
              state.loading.delete[budId] = false;
              state.errors.delete[budId] = error instanceof Error ? error.message : 'Failed to delete bud';
            });
            throw error;
          }
        },
        
        // Get single bud
        getBud: (budId: string) => {
          const bud = get().buds[budId];
          return bud ? (bud as unknown as Bud) : undefined;
        },
        
        // Get buds for workspace
        getWorkspaceBuds: (workspaceId: string) => {
          const budIds = get().workspaceBuds[workspaceId] || [];
          const buds = get().buds;
          return budIds.map(id => buds[id]).filter(Boolean).map(bud => bud as unknown as Bud);
        },
        
        // Clear all errors
        clearErrors: () => set((state) => {
          state.errors = {
            workspace: {},
            create: null,
            update: {},
            delete: {}
          };
        }),
        
        // Clear workspace-specific error
        clearWorkspaceError: (workspaceId: string) => set((state) => {
          state.errors.workspace[workspaceId] = null;
        }),
        
        // Clear bud-specific error
        clearBudError: (budId: string, type: 'update' | 'delete') => set((state) => {
          state.errors[type][budId] = null;
        })
      }))
  )
);

// Convenience hooks for specific data
export const useBud = (budId: string) => {
  const bud = useBudStore((state) => state.buds[budId]);
  return bud ? (bud as unknown as Bud) : undefined;
};

export const useWorkspaceBuds = (workspaceId: string) => {
  const budIds = useBudStore((state) => state.workspaceBuds[workspaceId]);
  const buds = useBudStore((state) => state.buds);
  
  return useMemo(() => {
    if (!budIds) return [];
    return budIds.map(id => buds[id]).filter(Boolean).map(bud => bud as unknown as Bud);
  }, [budIds, buds]);
};

export const useWorkspaceBudsLoading = (workspaceId: string) =>
  useBudStore((state) => state.loading.workspace[workspaceId] || false);

export const useWorkspaceBudsError = (workspaceId: string) =>
  useBudStore((state) => state.errors.workspace[workspaceId]);

export const useBudCreateLoading = () =>
  useBudStore((state) => state.loading.create);

export const useBudCreateError = () =>
  useBudStore((state) => state.errors.create);

export const useBudUpdateLoading = (budId: string) =>
  useBudStore((state) => state.loading.update[budId] || false);

export const useBudUpdateError = (budId: string) =>
  useBudStore((state) => state.errors.update[budId]);

export const useBudDeleteLoading = (budId: string) =>
  useBudStore((state) => state.loading.delete[budId] || false);

export const useBudDeleteError = (budId: string) =>
  useBudStore((state) => state.errors.delete[budId]);

// Action hooks - use shallow equality to prevent unnecessary re-renders
export const useLoadWorkspaceBuds = () => useBudStore((state) => state.loadWorkspaceBuds);
export const useCreateBud = () => useBudStore((state) => state.createBud);
export const useUpdateBud = () => useBudStore((state) => state.updateBud);
export const useDeleteBud = () => useBudStore((state) => state.deleteBud);
export const useClearBudErrors = () => useBudStore((state) => state.clearErrors);
