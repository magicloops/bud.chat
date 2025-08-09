// Core event types for vendor-agnostic message schema

import { ProgressState } from '@/lib/types/progress';
import { EventId, ToolCallId, ConversationId, generateEventId, generateToolCallId } from '@/lib/types/branded';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type Segment = 
  | { 
      type: 'text'; 
      text: string; 
      id?: string; 
      sequence_number?: number; 
      output_index?: number;
      citations?: Array<{
        url: string;
        title: string;
        start_index: number;
        end_index: number;
      }>;
    }
  | { 
      type: 'tool_call'; 
      id: ToolCallId; 
      name: string; 
      args: object; 
      server_label?: string;
      display_name?: string; // Human-readable tool name for UI
      server_type?: string; // Type of MCP server (local_mcp, remote_mcp)
      // Sequence metadata for OpenAI Responses API
      output_index?: number;
      sequence_number?: number;
      // For Responses API, tool results are stored directly on the tool_call
      output?: object;
      error?: string;
    }
  | { type: 'tool_result'; id: ToolCallId; output: object; error?: string }
  | { 
      type: 'reasoning'; 
      id: string; // item_id from OpenAI
      output_index: number;
      sequence_number: number;
      parts: ReasoningPart[];
      combined_text?: string;
      effort_level?: 'low' | 'medium' | 'high';
      reasoning_tokens?: number;
      // Streaming state (client-side only, not persisted)
      streaming?: boolean;
    }
  | {
      type: 'web_search_call';
      id: string; // item_id from OpenAI
      output_index: number;
      sequence_number: number;
      status: 'in_progress' | 'searching' | 'completed' | 'failed';
      // For streaming state tracking
      streaming?: boolean;
    }
  | {
      type: 'code_interpreter_call';
      id: string; // item_id from OpenAI
      output_index: number;
      sequence_number: number;
      status: 'in_progress' | 'interpreting' | 'completed' | 'failed';
      // Code content (can be streaming)
      code?: string;
      // For streaming state tracking
      streaming?: boolean;
    };

// Reasoning data types for OpenAI o-series models
export interface ReasoningPart {
  summary_index: number; // Index of this reasoning part
  type: 'summary_text';
  text: string;
  sequence_number: number;
  is_complete: boolean; // Whether this part is done streaming
  created_at: number; // Timestamp when part was created
}

export interface ReasoningData {
  item_id: string;
  output_index: number;
  sequence_number?: number; // Sequence ordering from OpenAI Responses API
  
  // Parts are indexed and can stream independently
  parts: Record<number, ReasoningPart>; // Keyed by summary_index
  
  // Combined text for display (computed from parts)
  combined_text?: string;
  
  // Metadata
  effort_level?: 'low' | 'medium' | 'high';
  reasoning_tokens?: number;
  
  // Client-side streaming state (not persisted to database)
  streaming_part_index?: number; // Which part is currently streaming
}

// Response-level metadata for OpenAI Responses API
export interface ResponseMetadata {
  total_output_items?: number;
  completion_status?: 'complete' | 'partial' | 'interrupted';
  usage?: {
    reasoning_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  // OpenAI-specific metadata
  openai_response_id?: string;
  model?: string;
}

export interface Event {
  id: EventId;           // uuid
  role: Role;
  segments: Segment[];  // ordered – may contain 1-N segments
  ts: number;          // unix millis
  
  // Response-level metadata (for Responses API)
  response_metadata?: ResponseMetadata;
  
  // Progress state (client-side only, not persisted)
  progressState?: ProgressState;
  
  // Legacy reasoning field - will be deprecated after migration
  reasoning?: ReasoningData; // Optional reasoning data for o-series models
}

export interface DatabaseEvent extends Event {
  conversation_id: ConversationId;
  order_key: string;
  created_at: string;
}

export interface ToolCall {
  id: ToolCallId;
  name: string;
  args: object;
  _rawArgs?: string; // Internal: for accumulating streaming arguments
}

export interface ToolResult {
  id: ToolCallId;
  output: object;
  error?: string;
}

export class EventLog {
  private events: Event[] = [];

  constructor(initialEvents: Event[] = []) {
    this.events = [...initialEvents];
  }

  addEvent(event: Event): void {
    // Check for duplicate event IDs
    const existingEvent = this.events.find(e => e.id === event.id);
    if (existingEvent) {
      console.error('🚨 DUPLICATE EVENT ID being added to EventLog:', {
        id: event.id,
        role: event.role,
        existingRole: existingEvent.role,
        stackTrace: new Error().stack
      });
    }
    
    this.events.push(event);
  }

  getEvents(): Event[] {
    return [...this.events];
  }

  getLastEvent(): Event | undefined {
    return this.events[this.events.length - 1];
  }

  getUnresolvedToolCalls(): ToolCall[] {
    const toolCalls = new Map<string, ToolCall>();
    const resolvedIds = new Set<string>();

    // Collect all tool calls and results
    for (const event of this.events) {
      for (const segment of event.segments) {
        if (segment.type === 'tool_call') {
          toolCalls.set(segment.id, {
            id: segment.id,
            name: segment.name,
            args: segment.args
          });
          
          // For Responses API, tool calls may have output directly on them
          if (segment.output !== undefined) {
            resolvedIds.add(segment.id);
          }
        } else if (segment.type === 'tool_result') {
          resolvedIds.add(segment.id);
        }
      }
    }

    // Return tool calls that don't have results
    const unresolvedCalls = Array.from(toolCalls.values())
      .filter(call => !resolvedIds.has(call.id));
    
    return unresolvedCalls;
  }

  getToolCallById(id: string): ToolCall | null {
    for (const event of this.events) {
      for (const segment of event.segments) {
        if (segment.type === 'tool_call' && segment.id === id) {
          return {
            id: segment.id,
            name: segment.name,
            args: segment.args
          };
        }
      }
    }
    return null;
  }

  getToolResultById(id: string): ToolResult | null {
    for (const event of this.events) {
      for (const segment of event.segments) {
        if (segment.type === 'tool_result' && segment.id === id) {
          return {
            id: segment.id,
            output: segment.output
          };
        }
      }
    }
    return null;
  }

  // Convert to provider-specific message format
  toProviderMessages(provider: 'anthropic' | 'openai'): unknown[] {
    if (provider === 'anthropic') {
      return this.toAnthropicMessages();
    } else if (provider === 'openai') {
      return this.toOpenAIMessages();
    }
    throw new Error(`Unsupported provider: ${provider}`);
  }

  // Get system parameter for Anthropic API (first event only, if it's a system message)
  getSystemParameter(): string {
    if (this.events.length === 0) return '';
    
    const firstEvent = this.events[0];
    if (firstEvent.role === 'system') {
      for (const segment of firstEvent.segments) {
        if (segment.type === 'text' && segment.text && segment.text.trim()) {
          return segment.text.trim();
        }
      }
    }
    return '';
  }

  private toAnthropicMessages(): unknown[] {
    const messages: unknown[] = [];
    
    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      
      if (i === 0 && event.role === 'system') {
        // First event is a system message, skip it (becomes system parameter)
        continue;
      }

      const content: unknown[] = [];
      
      for (const segment of event.segments) {
        switch (segment.type) {
          case 'text':
            if (segment.text && segment.text.trim()) {
              content.push({
                type: 'text',
                text: segment.text
              });
            }
            break;
          case 'tool_call':
            content.push({
              type: 'tool_use',
              id: segment.id,
              name: segment.name,
              input: segment.args
            });
            break;
          case 'tool_result':
            // Tool results become separate messages in Anthropic
            let toolContent = JSON.stringify(segment.output);
            
            // Truncate extremely large tool outputs to prevent context overflow
            const MAX_TOOL_RESULT_LENGTH = 30000; // ~7.5k tokens
            if (toolContent.length > MAX_TOOL_RESULT_LENGTH) {
              console.warn(`⚠️ [EventLog] Tool result truncated for Anthropic from ${toolContent.length} to ${MAX_TOOL_RESULT_LENGTH} characters`);
              toolContent = toolContent.substring(0, MAX_TOOL_RESULT_LENGTH) + '... [truncated]';
            }
            
            messages.push({
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: segment.id,
                content: toolContent
              }]
            });
            break;
        }
      }

      if (content.length > 0) {
        messages.push({
          role: event.role,
          content
        });
      }
    }

    return messages;
  }

  private toOpenAIMessages(): unknown[] {
    const messages: unknown[] = [];
    
    // Deduplicate events by ID to prevent duplicate assistant messages
    const seenEventIds = new Set<string>();
    const deduplicatedEvents = this.events.filter(event => {
      if (seenEventIds.has(event.id)) {
        console.warn('🚨 Duplicate event detected and filtered out:', {
          id: event.id,
          role: event.role,
          segmentTypes: event.segments.map(s => s.type)
        });
        return false;
      }
      seenEventIds.add(event.id);
      return true;
    });
    
    for (const event of deduplicatedEvents) {
      if (event.role === 'tool') {
        // Tool results become separate tool messages in OpenAI
        for (const segment of event.segments) {
          if (segment.type === 'tool_result') {
            let toolContent = JSON.stringify(segment.output);
            
            // Truncate extremely large tool outputs to prevent context overflow
            const MAX_TOOL_RESULT_LENGTH = 30000; // ~7.5k tokens
            if (toolContent.length > MAX_TOOL_RESULT_LENGTH) {
              console.warn(`⚠️ [EventLog] Tool result truncated for OpenAI from ${toolContent.length} to ${MAX_TOOL_RESULT_LENGTH} characters`);
              toolContent = toolContent.substring(0, MAX_TOOL_RESULT_LENGTH) + '... [truncated]';
            }
            
            messages.push({
              role: 'tool',
              tool_call_id: segment.id,
              content: toolContent
            });
          }
        }
        continue;
      }

      let content = '';
      const tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
      
      // Handle empty or undefined segments
      const segments = event.segments || [];
      
      for (const segment of segments) {
        switch (segment.type) {
          case 'text':
            if (segment.text) {
              content += segment.text;
            }
            break;
          case 'tool_call':
            tool_calls.push({
              id: segment.id,
              type: 'function',
              function: {
                name: segment.name,
                arguments: JSON.stringify(segment.args)
              }
            });
            break;
          case 'tool_result':
            // Tool results are handled as separate messages above
            break;
        }
      }

      // Skip assistant messages that have no content and no tool calls (placeholders)
      if (event.role === 'assistant' && !content && tool_calls.length === 0) {
        continue;
      }

      const message: Record<string, unknown> = {
        role: event.role,
        content: content || ''  // Use empty string instead of null
      };

      if (tool_calls.length > 0) {
        message.tool_calls = tool_calls;
      }

      messages.push(message);
    }

    return messages;
  }

  // Extract system messages for Anthropic
  getSystemMessage(): string {
    const systemTexts: string[] = [];
    
    for (const event of this.events) {
      if (event.role === 'system') {
        for (const segment of event.segments) {
          if (segment.type === 'text' && segment.text) {
            systemTexts.push(segment.text);
          }
        }
      }
    }

    return systemTexts.join('\n\n');
  }

  updateEvent(event: Event): boolean {
    const index = this.events.findIndex(e => e.id === event.id);
    if (index >= 0) {
      this.events[index] = event;
      return true;
    }
    console.warn('⚠️ Event not found for update:', { id: event.id, role: event.role });
    return false;
  }
}

// Helper functions for creating events
export function createTextEvent(role: Role, text: string, timestamp?: number): Event {
  return {
    id: generateEventId(),
    role,
    segments: [{ type: 'text', text }],
    ts: timestamp || Date.now()
  };
}

export function createToolCallEvent(id: ToolCallId, name: string, args: object, timestamp?: number): Event {
  return {
    id: generateEventId(),
    role: 'assistant',
    segments: [{ type: 'tool_call', id, name, args }],
    ts: timestamp || Date.now()
  };
}

export function createToolResultEvent(id: ToolCallId, output: object, timestamp?: number): Event {
  return {
    id: generateEventId(),
    role: 'tool',
    segments: [{ type: 'tool_result', id, output }],
    ts: timestamp || Date.now()
  };
}

export function createMixedEvent(role: Role, segments: Segment[], timestamp?: number): Event {
  return {
    id: generateEventId(),
    role,
    segments,
    ts: timestamp || Date.now()
  };
}

export function createReasoningSegment(
  id: string, 
  output_index: number, 
  sequence_number: number, 
  parts: ReasoningPart[],
  options?: {
    combined_text?: string;
    effort_level?: 'low' | 'medium' | 'high';
    reasoning_tokens?: number;
    streaming?: boolean;
  }
): Segment {
  return {
    type: 'reasoning',
    id,
    output_index,
    sequence_number,
    parts,
    combined_text: options?.combined_text,
    effort_level: options?.effort_level,
    reasoning_tokens: options?.reasoning_tokens,
    streaming: options?.streaming
  };
}

// Helper to sort segments by sequence number
export function sortSegmentsBySequence(segments: Segment[]): Segment[] {
  return segments.sort((a, b) => {
    const aSeq = 'sequence_number' in a ? a.sequence_number || 0 : 0;
    const bSeq = 'sequence_number' in b ? b.sequence_number || 0 : 0;
    return aSeq - bSeq;
  });
}