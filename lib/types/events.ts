// Core event types for vendor-agnostic message schema

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type Segment = 
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: object }
  | { type: 'tool_result'; id: string; output: object; error?: string };

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
  
  // Parts are indexed and can stream independently
  parts: Record<number, ReasoningPart>; // Keyed by summary_index
  
  // Combined text for display (computed from parts)
  combined_text?: string;
  
  // Metadata
  effort_level?: 'low' | 'medium' | 'high';
  reasoning_tokens?: number;
  
  // Streaming state
  is_streaming?: boolean;
  streaming_part_index?: number; // Which part is currently streaming
  
  // Debug info
  raw_events: Array<{
    type: string;
    data: unknown;
    sequence_number: number;
    timestamp: number;
  }>;
}

export interface Event {
  id: string;           // uuid
  role: Role;
  segments: Segment[];  // ordered – may contain 1-N segments
  ts: number;          // unix millis
  reasoning?: ReasoningData; // Optional reasoning data for o-series models
}

export interface DatabaseEvent extends Event {
  conversation_id: string;
  order_key: string;
  created_at: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: object;
}

export interface ToolResult {
  id: string;
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
    
    console.log('📝 Adding event to EventLog:', { id: event.id, role: event.role, totalEvents: this.events.length + 1 });
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
          console.log('🔍 Found tool call segment:', {
            id: segment.id,
            name: segment.name,
            args: segment.args,
            argsType: typeof segment.args
          });
          toolCalls.set(segment.id, {
            id: segment.id,
            name: segment.name,
            args: segment.args
          });
        } else if (segment.type === 'tool_result') {
          resolvedIds.add(segment.id);
        }
      }
    }

    // Return tool calls that don't have results
    const unresolvedCalls = Array.from(toolCalls.values())
      .filter(call => !resolvedIds.has(call.id));
    
    console.log('🔧 Unresolved tool calls:', unresolvedCalls.map(call => ({
      id: call.id,
      name: call.name,
      args: call.args,
      argsType: typeof call.args
    })));
    
    return unresolvedCalls
      .filter(call => !resolvedIds.has(call.id));
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
            messages.push({
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: segment.id,
                content: JSON.stringify(segment.output)
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
    
    for (const event of this.events) {
      if (event.role === 'tool') {
        // Tool results become separate tool messages in OpenAI
        for (const segment of event.segments) {
          if (segment.type === 'tool_result') {
            messages.push({
              role: 'tool',
              tool_call_id: segment.id,
              content: JSON.stringify(segment.output)
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
}

// Helper functions for creating events
export function createTextEvent(role: Role, text: string, timestamp?: number): Event {
  return {
    id: crypto.randomUUID(),
    role,
    segments: [{ type: 'text', text }],
    ts: timestamp || Date.now()
  };
}

export function createToolCallEvent(id: string, name: string, args: object, timestamp?: number): Event {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    segments: [{ type: 'tool_call', id, name, args }],
    ts: timestamp || Date.now()
  };
}

export function createToolResultEvent(id: string, output: object, timestamp?: number): Event {
  return {
    id: crypto.randomUUID(),
    role: 'tool',
    segments: [{ type: 'tool_result', id, output }],
    ts: timestamp || Date.now()
  };
}

export function createMixedEvent(role: Role, segments: Segment[], timestamp?: number): Event {
  return {
    id: crypto.randomUUID(),
    role,
    segments,
    ts: timestamp || Date.now()
  };
}