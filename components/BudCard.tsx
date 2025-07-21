'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, MessageSquare } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Bud } from '@/lib/types';
import { getBudConfig, getBudDisplayName, getBudAvatar, getBudModel } from '@/lib/budHelpers';

interface BudCardProps {
  bud: Bud
  onClick: () => void
  onEdit?: () => void
  onDelete?: () => void
  showActions?: boolean
}

export function BudCard({ bud, onClick, onEdit, onDelete, showActions = false }: BudCardProps) {
  const config = getBudConfig(bud);
  const displayName = getBudDisplayName(bud);
  const avatar = getBudAvatar(bud);
  const model = getBudModel(bud);

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't trigger onClick if clicking on actions menu
    if ((e.target as HTMLElement).closest('[data-dropdown-trigger]')) {
      return;
    }
    onClick();
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
  };

  return (
    <Card 
      className="cursor-pointer hover:shadow-md hover:ring-2 hover:ring-primary/20 transition-all duration-200 group relative" 
      onClick={handleCardClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="text-2xl flex-shrink-0">
              {avatar}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-base truncate">{displayName}</h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-xs">
                  {model}
                </Badge>
                {config.temperature !== undefined && (
                  <Badge variant="outline" className="text-xs">
                    temp: {config.temperature}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          
          {showActions && (onEdit || onDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild data-dropdown-trigger>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onEdit && (
                  <DropdownMenuItem onClick={handleEdit}>
                    Edit Bud
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                    Delete Bud
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
          {config.systemPrompt}
        </p>
        
        {config.greeting && (
          <p className="text-xs text-muted-foreground/80 italic line-clamp-2 mb-3">
            &ldquo;{config.greeting}&rdquo;
          </p>
        )}
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            <span>Start Chat</span>
          </div>
          
          <div className="text-xs text-muted-foreground">
            {new Date(bud.created_at).toLocaleDateString()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}