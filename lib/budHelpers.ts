import { createClient } from '@/lib/supabase/client';
import { Bud, BudConfig } from '@/lib/types';
import { Database } from '@/lib/types/database';
import { Event } from '@/state/eventChatStore';
import { createTextEvent } from '@/lib/types/events';
// import { generateKeyBetween } from 'fractional-indexing'; // Currently unused
import { getDefaultModel } from './modelMapping';

export interface CreateBudArgs {
  name: string
  config: BudConfig
  workspaceId: string
  isPublic?: boolean
}

export interface UpdateBudArgs {
  name?: string
  config?: Partial<BudConfig>
}

// Client-side Bud operations
export class BudManager {
  private supabase = createClient();

  async getWorkspaceBuds(workspaceId: string): Promise<Bud[]> {
    const response = await fetch(`/api/buds?workspaceId=${workspaceId}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch buds: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.buds || [];
  }

  async getBud(budId: string): Promise<Bud> {
    const response = await fetch(`/api/buds/${budId}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch bud: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.bud;
  }

  async createBud(args: CreateBudArgs): Promise<Bud> {
    const response = await fetch('/api/buds', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create bud');
    }

    const data = await response.json();
    return data.bud;
  }

  async updateBud(budId: string, updates: UpdateBudArgs): Promise<Bud> {
    const response = await fetch(`/api/buds/${budId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update bud');
    }

    const data = await response.json();
    return data.bud;
  }

  async deleteBud(budId: string): Promise<void> {
    const response = await fetch(`/api/buds/${budId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete bud');
    }
  }
}

// Singleton instance
export const budManager = new BudManager();

// Utility functions for working with Buds
export function getBudConfig(bud: Bud): BudConfig {
  return bud.default_json as BudConfig;
}

export function createBudSystemEvent(bud: Bud, _conversationId: string = 'temp'): Event {
  const config = getBudConfig(bud);
  
  return createTextEvent('system', config.systemPrompt);
}

export function createBudGreetingEvent(bud: Bud, _conversationId: string = 'temp'): Event | null {
  const config = getBudConfig(bud);
  
  if (!config.greeting) return null;
  
  return createTextEvent('assistant', config.greeting);
}

export function createBudInitialEvents(bud: Bud, conversationId: string = 'temp'): Event[] {
  const events: Event[] = [];
  
  // Always add system event
  events.push(createBudSystemEvent(bud, conversationId));
  
  // Add greeting if present
  const greeting = createBudGreetingEvent(bud, conversationId);
  if (greeting) {
    events.push(greeting);
  }
  
  return events;
}

export function validateBudConfig(config: Partial<BudConfig>): string[] {
  const errors: string[] = [];
  
  if (!config.name?.trim()) {
    errors.push('Bud name is required');
  }
  
  if (!config.systemPrompt?.trim()) {
    errors.push('System prompt is required');
  }
  
  if (!config.model?.trim()) {
    errors.push('AI model is required');
  }
  
  if (config.temperature !== undefined) {
    if (config.temperature < 0 || config.temperature > 1) {
      errors.push('Temperature must be between 0 and 1');
    }
  }
  
  if (config.maxTokens !== undefined) {
    if (config.maxTokens < 1 || config.maxTokens > 32000) {
      errors.push('Max tokens must be between 1 and 32000');
    }
  }
  
  return errors;
}

export function getDefaultBudConfig(): BudConfig {
  return {
    name: '',
    systemPrompt: 'You are a helpful, harmless, and honest AI assistant.',
    model: getDefaultModel(),
    temperature: 0.7,
    maxTokens: 2048,
    avatar: '🤖'
  };
}

export function getBudDisplayName(bud: Bud): string {
  const config = getBudConfig(bud);
  return config.name || bud.name || 'Unnamed Bud';
}

export function getBudAvatar(bud: Bud): string {
  const config = getBudConfig(bud);
  return config.avatar || '🤖';
}

export function getBudModel(bud: Bud): string {
  const config = getBudConfig(bud);
  return config.model || 'gpt-4o';
}

export function getBudTemperature(bud: Bud): number {
  const config = getBudConfig(bud);
  return config.temperature ?? 0.7;
}

// New helper functions for override-only conversation approach
export function getEffectiveConversationConfig(conversation: Database['public']['Tables']['conversations']['Row'], sourceBud?: Bud) {
  const budConfig = sourceBud ? getBudConfig(sourceBud) : null;
  const overrides = (conversation.model_config_overrides && typeof conversation.model_config_overrides === 'object' && !Array.isArray(conversation.model_config_overrides)) 
    ? conversation.model_config_overrides as Record<string, unknown>
    : {};
  
  return {
    // Identity
    assistant_name: conversation.assistant_name || budConfig?.name || 'Assistant',
    assistant_avatar: conversation.assistant_avatar || budConfig?.avatar || '🤖',
    
    // Model settings
    model: (typeof overrides.model === 'string' ? overrides.model : null) || budConfig?.model || 'gpt-4o',
    temperature: (typeof overrides.temperature === 'number' ? overrides.temperature : null) ?? budConfig?.temperature ?? 0.7,
    max_tokens: (typeof overrides.max_tokens === 'number' ? overrides.max_tokens : null) || budConfig?.maxTokens,
    system_prompt: (typeof overrides.system_prompt === 'string' ? overrides.system_prompt : null) || budConfig?.systemPrompt || 'You are a helpful assistant.',
    greeting: (typeof overrides.greeting === 'string' ? overrides.greeting : null) || budConfig?.greeting,
    
    // Model-specific settings
    top_p: (typeof overrides.top_p === 'number' ? overrides.top_p : null),
    presence_penalty: (typeof overrides.presence_penalty === 'number' ? overrides.presence_penalty : null),
    anthropic_version: (typeof overrides.anthropic_version === 'string' ? overrides.anthropic_version : null)
  };
}

export function hasConversationOverrides(conversation: Database['public']['Tables']['conversations']['Row']): boolean {
  return !!(
    conversation.assistant_name ||
    conversation.assistant_avatar ||
    conversation.model_config_overrides
  );
}

export function getConversationDisplayName(conversation: Database['public']['Tables']['conversations']['Row'], sourceBud?: Bud): string {
  const config = getEffectiveConversationConfig(conversation, sourceBud);
  return config.assistant_name;
}

export function getConversationAvatar(conversation: Database['public']['Tables']['conversations']['Row'], sourceBud?: Bud): string {
  const config = getEffectiveConversationConfig(conversation, sourceBud);
  return config.assistant_avatar;
}

// Note: Server-side bud fetching should be done in API routes or server components
// This file contains only client-side helper functions

// Predefined bud templates for common use cases
export const BUD_TEMPLATES: Record<string, Partial<BudConfig>> = {
  assistant: {
    name: 'General Assistant',
    systemPrompt: 'You are a helpful, harmless, and honest AI assistant. You provide clear, accurate, and helpful responses to user questions.',
    model: getDefaultModel(),
    temperature: 0.7,
    avatar: '🤖',
    greeting: 'Hello! I\'m here to help you with any questions or tasks you have. How can I assist you today?'
  },
  
  coder: {
    name: 'Coding Assistant',
    systemPrompt: 'You are an expert software developer and coding assistant. You help users write clean, efficient, and well-documented code. You explain concepts clearly and provide practical examples.',
    model: getDefaultModel(),
    temperature: 0.3,
    avatar: '👨‍💻',
    greeting: 'Ready to code! I can help you with programming questions, code reviews, debugging, and best practices. What are you working on?'
  },
  
  writer: {
    name: 'Creative Writer',
    systemPrompt: 'You are a creative writing assistant. You help users with storytelling, creative writing, editing, and improving their prose. You are encouraging and provide constructive feedback.',
    model: getDefaultModel(),
    temperature: 0.8,
    avatar: '✍️',
    greeting: 'Welcome to your creative writing space! I\'m here to help you craft compelling stories, improve your writing, or brainstorm ideas. What would you like to write about?'
  },
  
  analyst: {
    name: 'Data Analyst',
    systemPrompt: 'You are a data analysis expert. You help users understand data, create visualizations, perform statistical analysis, and derive insights from datasets. You explain complex concepts in simple terms.',
    model: getDefaultModel(),
    temperature: 0.4,
    avatar: '📊',
    greeting: 'Hello! I\'m your data analysis partner. I can help you explore data, create charts, run statistical tests, and find meaningful insights. What data are you working with?'
  },
  
  tutor: {
    name: 'Learning Tutor',
    systemPrompt: 'You are a patient and knowledgeable tutor. You help users learn new concepts by breaking them down into understandable parts, providing examples, and encouraging questions.',
    model: getDefaultModel(),
    temperature: 0.6,
    avatar: '🎓',
    greeting: 'Welcome to your personal learning session! I\'m here to help you understand any topic you\'re curious about. What would you like to learn today?'
  }
};