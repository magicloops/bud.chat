'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Plus } from 'lucide-react'

interface CreateBudCardProps {
  onClick: () => void
}

export function CreateBudCard({ onClick }: CreateBudCardProps) {
  return (
    <Card 
      className="cursor-pointer hover:shadow-md hover:ring-2 hover:ring-primary/20 transition-all duration-200 border-dashed border-2 min-h-[200px]" 
      onClick={onClick}
    >
      <CardContent className="flex flex-col items-center justify-center h-full min-h-[200px] text-center p-6">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Plus className="h-6 w-6 text-primary" />
        </div>
        
        <h3 className="font-semibold text-base mb-2">Create New Bud</h3>
        
        <p className="text-sm text-muted-foreground">
          Create a custom AI assistant with your own personality, instructions, and preferences.
        </p>
      </CardContent>
    </Card>
  )
}