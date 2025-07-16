// Core event types for vendor-agnostic message schema

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type Segment = 
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: object }
  | { type: 'tool_result'; id: string; output: object };

export interface Event {
  id: string;           // uuid
  role: Role;
  segments: Segment[];  // ordered – may contain 1-N segments
  ts: number;          // unix millis
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
    this.events.push(event);
  }

  getEvents(): Event[] {
    return [...this.events];
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
          })
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
  toProviderMessages(provider: 'anthropic' | 'openai'): any[] {
    if (provider === 'anthropic') {
      return this.toAnthropicMessages();
    } else if (provider === 'openai') {
      return this.toOpenAIMessages();
    }
    throw new Error(`Unsupported provider: ${provider}`);
  }

  private toAnthropicMessages(): any[] {
    const messages: any[] = [];
    
    for (const event of this.events) {
      if (event.role === 'system') {
        // System messages are handled separately in Anthropic
        continue;
      }

      const content: any[] = [];
      
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

  private toOpenAIMessages(): any[] {
    const messages: any[] = [];
    
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
      const tool_calls: any[] = [];
      
      for (const segment of event.segments) {
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

      const message: any = {
        role: event.role,
        content: content || null
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