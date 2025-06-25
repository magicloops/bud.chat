'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Loader2, Sparkles } from 'lucide-react'
import { EmojiPicker } from '@/components/EmojiPicker'
import { Bud, BudConfig } from '@/lib/types'
import { getBudConfig, getDefaultBudConfig, validateBudConfig, BUD_TEMPLATES } from '@/lib/budHelpers'

interface BudFormProps {
  bud?: Bud
  workspaceId: string
  open: boolean
  onClose: () => void
  onSave: (config: BudConfig, name: string) => Promise<void>
  loading?: boolean
}

export function BudForm({ bud, workspaceId, open, onClose, onSave, loading = false }: BudFormProps) {
  const [config, setConfig] = useState<BudConfig>(() => 
    bud ? getBudConfig(bud) : getDefaultBudConfig()
  )
  const [errors, setErrors] = useState<string[]>([])

  // Reset form when bud changes
  useEffect(() => {
    if (bud) {
      setConfig(getBudConfig(bud))
    } else {
      setConfig(getDefaultBudConfig())
    }
    setErrors([])
  }, [bud])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate
    const validationErrors = validateBudConfig(config)
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }
    
    setErrors([])
    
    try {
      await onSave(config, config.name)
      onClose()
    } catch (error) {
      console.error('Failed to save bud:', error)
      setErrors([error instanceof Error ? error.message : 'Failed to save bud'])
    }
  }

  const handleTemplateSelect = (templateKey: string) => {
    const template = BUD_TEMPLATES[templateKey]
    if (template) {
      setConfig({ ...getDefaultBudConfig(), ...template })
    }
  }

  const isEditing = !!bud

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
              This defines your bud's personality and instructions.
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
                      <SelectItem value="gpt-4o">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">OpenAI</Badge>
                          GPT-4o
                        </div>
                      </SelectItem>
                      <SelectItem value="gpt-4o-mini">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">OpenAI</Badge>
                          GPT-4o Mini
                        </div>
                      </SelectItem>
                      <SelectItem value="gpt-3.5-turbo">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">OpenAI</Badge>
                          GPT-3.5 Turbo
                        </div>
                      </SelectItem>
                      <SelectItem value="claude-3.5-sonnet">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Anthropic</Badge>
                          Claude 3.5 Sonnet
                        </div>
                      </SelectItem>
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
              </div>
            </CardContent>
          </Card>
          
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
  )
}