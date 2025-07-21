import { EventStreamBuilder } from './eventBuilder';
import { EventLog } from '@/lib/types/events';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface StreamEvent {
  type: 'token' | 'tool_start' | 'tool_finalized' | 'tool_result' | 'tool_complete' | 'complete' | 'error';
  content?: string;
  tool_id?: string;
  tool_name?: string;
  args?: object;
  output?: object;
  error?: string;
}

export class ChatStreamHandler {
  private encoder = new TextEncoder();

  constructor(
    private eventBuilder: EventStreamBuilder,
    private eventLog: EventLog,
    private controller: ReadableStreamDefaultController,
    private options: {
      debug?: boolean;
      conversationId?: string;
    } = {}
  ) {}

  /**
   * Handle Anthropic streaming response with unified logic
   */
  async handleAnthropicStream(stream: AsyncIterable<Anthropic.Messages.MessageStreamEvent>): Promise<void> {
    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            // Reset builder for new message (generates new unique ID)
            this.eventBuilder.reset('assistant');
            break;
            
          case 'content_block_start':
            if (event.content_block?.type === 'text') {
              // Text block started - builder is ready
            } else if (event.content_block?.type === 'tool_use') {
              // Tool use block started
              if (event.content_block.id && event.content_block.name) {
                // Start streaming tool call (don't finalize yet)
                this.eventBuilder.startToolCall(event.content_block.id, event.content_block.name);
                
                // Stream tool call start event
                this.streamEvent({
                  type: 'tool_start',
                  tool_id: event.content_block.id,
                  tool_name: event.content_block.name,
                  content: `🔧 *Using tool: ${event.content_block.name}*\n`
                });
              }
            }
            break;
            
          case 'content_block_delta':
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              // Add text chunk to event builder
              this.eventBuilder.addTextChunk(event.delta.text);
              
              // Stream text content
              if (this.options.debug) {
                console.log('📤 Streaming token:', event.delta.text);
              }
              
              this.streamEvent({
                type: 'token',
                content: event.delta.text
              });
            } else if (event.delta?.type === 'input_json_delta' && event.index !== undefined) {
              // Handle tool call argument accumulation
              const toolCallId = this.eventBuilder.getToolCallIdAtIndex(event.index);
              if (toolCallId && event.delta.partial_json) {
                this.eventBuilder.addToolCallArguments(toolCallId, event.delta.partial_json);
              }
            }
            break;
            
          case 'content_block_stop':
            // Complete any streaming tool calls
            if (event.index !== undefined) {
              const toolCallId = this.eventBuilder.getToolCallIdAtIndex(event.index);
              if (toolCallId) {
                this.eventBuilder.completeToolCall(toolCallId);
              }
            }
            break;
            
          case 'message_stop':
            // Finalize the event and add to log
            const finalEvent = this.eventBuilder.finalize();
            this.eventLog.addEvent(finalEvent);
            
            // Stream finalized tool calls with complete arguments
            const toolCallSegments = finalEvent.segments.filter(s => s.type === 'tool_call');
            for (const toolCall of toolCallSegments) {
              this.streamEvent({
                type: 'tool_finalized',
                tool_id: toolCall.id,
                tool_name: toolCall.name,
                args: toolCall.args
              });
            }
            
            // If no tool calls, we're done with this iteration
            return;
        }
      }
    } catch (error) {
      console.error('Error in Anthropic stream handling:', error);
      this.streamEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown streaming error'
      });
      throw error;
    }
  }

  /**
   * Handle OpenAI streaming response with unified logic
   */
  async handleOpenAIStream(stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>): Promise<void> {
    try {
      let activeToolCalls = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        
        // Handle text content
        if (delta.content) {
          this.eventBuilder.addTextChunk(delta.content);
          
          if (this.options.debug) {
            console.log('📤 Streaming token:', delta.content);
          }
          
          this.streamEvent({
            type: 'token',
            content: delta.content
          });
        }
        
        // Handle tool calls
        if (delta.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index;
            if (index === undefined) continue;

            // Initialize or update tool call tracking
            if (!activeToolCalls.has(index)) {
              const toolCallId = toolCallDelta.id || `tool_${Date.now()}_${index}`;
              const toolName = toolCallDelta.function?.name || 'unknown';
              
              activeToolCalls.set(index, {
                id: toolCallId,
                name: toolName,
                args: ''
              });
              
              // Start tool call in event builder
              this.eventBuilder.startToolCall(toolCallId, toolName);
              
              // Stream tool start event
              this.streamEvent({
                type: 'tool_start',
                tool_id: toolCallId,
                tool_name: toolName,
                content: `🔧 *Using tool: ${toolName}*\n`
              });
            }
            
            // Accumulate arguments
            if (toolCallDelta.function?.arguments) {
              const toolCall = activeToolCalls.get(index)!;
              toolCall.args += toolCallDelta.function.arguments;
              
              // Update tool call arguments in event builder
              this.eventBuilder.addToolCallArguments(toolCall.id, toolCallDelta.function.arguments);
            }
          }
        }
        
        // Handle completion
        if (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls') {
          // Finalize all active tool calls
          for (const [index, toolCall] of activeToolCalls) {
            this.eventBuilder.completeToolCall(toolCall.id);
            
            // Parse final arguments
            let parsedArgs = {};
            try {
              parsedArgs = JSON.parse(toolCall.args);
            } catch (e) {
              console.warn('Failed to parse tool call arguments:', toolCall.args);
            }
            
            this.streamEvent({
              type: 'tool_finalized',
              tool_id: toolCall.id,
              tool_name: toolCall.name,
              args: parsedArgs
            });
          }
          
          // Finalize the event and add to log
          const finalEvent = this.eventBuilder.finalize();
          this.eventLog.addEvent(finalEvent);
          
          // Clear active tool calls
          activeToolCalls.clear();
          return;
        }
      }
    } catch (error) {
      console.error('Error in OpenAI stream handling:', error);
      this.streamEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown streaming error'
      });
      throw error;
    }
  }

  /**
   * Stream an event to the client
   */
  private streamEvent(eventData: StreamEvent): void {
    try {
      const data = `data: ${JSON.stringify(eventData)}\n\n`;
      this.controller.enqueue(this.encoder.encode(data));
    } catch (error) {
      console.error('Error streaming event:', error);
    }
  }

  /**
   * Send completion signal
   */
  complete(): void {
    this.streamEvent({ type: 'complete' });
  }

  /**
   * Send error signal
   */
  error(message: string): void {
    this.streamEvent({ 
      type: 'error', 
      error: message 
    });
  }
}