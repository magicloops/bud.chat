// OpenAI Responses API Provider (for reasoning models)
import { OpenAIBaseProvider } from './OpenAIBaseProvider';
import { 
  UnifiedChatRequest, 
  UnifiedChatResponse, 
  StreamEvent,
  ProviderFeature,
  ValidationResult 
} from './types';
import { 
  Event, 
  ReasoningPart,
  Segment,
  generateEventId,
  ToolCallId,
  generateToolCallId
} from '@budchat/events';
import { processResponsesAPIStream } from './utils/openaiResponsesUtils';

// Extended stream event for custom event types
interface ExtendedStreamEvent {
  type: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

// Type definitions for OpenAI Responses API
interface ResponsesCreateParams {
  model: string;
  input: ResponsesInputItem[];
  max_output_tokens: number;
  include?: string[];
  reasoning?: {
    effort: 'minimal' | 'low' | 'medium' | 'high';
    summary: 'auto' | 'concise' | 'detailed';
  };
  text?: {
    verbosity: 'low' | 'medium' | 'high';
  };
  tools?: (ResponsesMCPTool | ResponsesBuiltInTool)[];
}

interface ResponsesInputItem {
  id?: string;
  type: 'message' | 'text' | 'mcp_call' | 'reasoning';
  role?: 'user' | 'assistant' | 'system';
  content?: string | Array<{ type: string; text: string }>;
  text?: string;
  name?: string;
  output?: string;
  error?: string;
  summary?: Array<{ type: string; text: string }>;
}

interface ResponsesMCPTool {
  type: 'mcp';
  server_label: string;
  server_url: string;
  require_approval: 'never' | 'always' | { never?: { tool_names: string[] }; always?: { tool_names: string[] } };
  allowed_tools?: string[];
  headers?: Record<string, string>;
}

interface ResponsesBuiltInTool {
  type: 'web_search_preview' | 'code_interpreter';
  search_context_size?: 'low' | 'medium' | 'high';
  container?: string;
}

export class OpenAIResponsesProvider extends OpenAIBaseProvider {
  name = 'openai-responses' as const;
  provider = 'openai' as const;
  
  supportsFeature(feature: ProviderFeature): boolean {
    const responsesFeatures = [
      ProviderFeature.REASONING,
      ProviderFeature.REASONING_EFFORT,
      ProviderFeature.TOOL_CALLING,
      ProviderFeature.STREAMING,
    ];
    return super.supportsFeature(feature) || responsesFeatures.includes(feature);
  }
  
  protected validateProviderSpecific(_config: Partial<UnifiedChatRequest>): ValidationResult {
    return { valid: true, errors: [], warnings: [] };
  }
  
  protected getFeatureSupport(): Partial<Record<ProviderFeature, boolean>> {
    return { [ProviderFeature.REASONING]: true, [ProviderFeature.REASONING_EFFORT]: true, [ProviderFeature.TOOL_CALLING]: true, [ProviderFeature.STREAMING]: true };
  }

  private buildToolsArray(request: UnifiedChatRequest): (ResponsesMCPTool | ResponsesBuiltInTool)[] {
    const tools: (ResponsesMCPTool | ResponsesBuiltInTool)[] = [];
    if (request.mcpConfig?.remote_servers && request.mcpConfig.remote_servers.length > 0) {
      const mcpTools = request.mcpConfig.remote_servers.map(server => ({
        type: 'mcp' as const,
        server_label: server.server_label,
        server_url: server.server_url,
        require_approval: server.require_approval || 'never',
        allowed_tools: server.allowed_tools,
        headers: server.headers
      }));
      tools.push(...mcpTools);
    }
    if (request.builtInToolsConfig?.enabled_tools && request.builtInToolsConfig.enabled_tools.length > 0) {
      for (const toolType of request.builtInToolsConfig.enabled_tools) {
        const toolSettings = (request.builtInToolsConfig.tool_settings[toolType] as { search_context_size?: 'low' | 'medium' | 'high'; container?: string } | undefined) || {};
        if (toolType === 'web_search_preview') {
          tools.push({ type: 'web_search_preview', search_context_size: toolSettings.search_context_size || 'medium' });
        } else if (toolType === 'code_interpreter') {
          tools.push({ type: 'code_interpreter', container: toolSettings.container || 'default' });
        }
      }
    }
    return tools;
  }

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    try {
      const inputItems = this.convertEventsToInputItems(request.events);
      const params: ResponsesCreateParams = { model: this.getModelName(request.model), input: inputItems, max_output_tokens: request.maxTokens || 8000, include: ['reasoning.encrypted_content'] };
      const tools = this.buildToolsArray(request);
      if (tools.length > 0) params.tools = tools;
      let reasoningEffort = request.reasoningConfig?.effort || request.reasoningEffort || 'low';
      const hasBuiltInTools = !!(request.builtInToolsConfig?.enabled_tools && request.builtInToolsConfig.enabled_tools.length > 0);
      if (hasBuiltInTools && reasoningEffort === 'minimal') reasoningEffort = 'low';
      const summaryDefault = request.model.startsWith('gpt-5') ? 'detailed' : 'auto';
      params.reasoning = { effort: reasoningEffort as any, summary: request.reasoningConfig?.summary || summaryDefault };
      if (request.textGenerationConfig?.verbosity) params.text = { verbosity: request.textGenerationConfig.verbosity } as any;
      const response = await this.client.responses.create(params as any);
      const event = this.convertResponseToEvent(response);
      const usage = 'usage' in response && (response as any).usage ? { promptTokens: (response as any).usage.input_tokens, completionTokens: (response as any).usage.output_tokens, totalTokens: (response as any).usage.total_tokens } : undefined;
      return { event, usage };
    } catch (error) {
      throw this.handleProviderError(error);
    }
  }
  
  async *stream(request: UnifiedChatRequest): AsyncGenerator<StreamEvent> {
    try {
      const inputItems = this.convertEventsToInputItems(request.events);
      const params: ResponsesCreateParams & { stream: true } = { model: this.getModelName(request.model), input: inputItems, max_output_tokens: request.maxTokens || 8000, stream: true, include: ['reasoning.encrypted_content'] };
      const tools = this.buildToolsArray(request);
      if (tools.length > 0) params.tools = tools;
      let reasoningEffort = request.reasoningConfig?.effort || request.reasoningEffort || 'low';
      const hasBuiltInTools = !!(request.builtInToolsConfig?.enabled_tools && request.builtInToolsConfig.enabled_tools.length > 0);
      if (hasBuiltInTools && reasoningEffort === 'minimal') reasoningEffort = 'low';
      const summaryDefault = request.model.startsWith('gpt-5') ? 'detailed' : 'auto';
      params.reasoning = { effort: reasoningEffort as any, summary: request.reasoningConfig?.summary || summaryDefault };
      if (request.textGenerationConfig?.verbosity) params.text = { verbosity: request.textGenerationConfig.verbosity } as any;
      const streamResponse = await this.client.responses.create(params as any);
      const processedStream = processResponsesAPIStream(streamResponse as unknown as AsyncIterable<unknown>);
      const currentEvent: Event = { id: generateEventId(), role: 'assistant', segments: [], ts: Date.now() };
      let hasStarted = false; let currentMessageId: string | undefined; let streamCompleted = false;
      for await (const streamEvent of processedStream as AsyncGenerator<ExtendedStreamEvent>) {
        if (streamCompleted) continue;
        if (!hasStarted) { yield { type: 'event', data: { event: currentEvent } } as any; hasStarted = true; }
        switch (streamEvent.type) {
          case 'response.created':
          case 'response.in_progress':
            break;
          case 'response.completed':
            streamCompleted = true; yield { type: 'done' } as any; return;
          case 'message_start':
            currentMessageId = streamEvent.item_id as string; break;
          case 'text_start': {
            const textSegmentWithId: Segment = { type: 'text', id: streamEvent.item_id as string, text: (streamEvent as any).content || '', sequence_number: (streamEvent as any).sequence_number, output_index: (streamEvent as any).output_index } as any;
            currentEvent.segments.push(textSegmentWithId);
            if ((streamEvent as any).content) yield { type: 'segment', data: { segment: { type: 'text', text: (streamEvent as any).content }, segmentIndex: currentEvent.segments.length - 1 } } as any;
            break; }
          case 'token': {
            if ((streamEvent as any).content && typeof (streamEvent as any).content === 'string') {
              let textSegment = currentEvent.segments.find(s => s.type === 'text') as any;
              if (!textSegment) { textSegment = { type: 'text', text: '', id: currentMessageId }; currentEvent.segments.push(textSegment); }
              textSegment.text += (streamEvent as any).content;
              yield { type: 'segment', data: { segment: { type: 'text', text: (streamEvent as any).content }, segmentIndex: currentEvent.segments.indexOf(textSegment) } } as any;
            }
            break; }
          case 'reasoning_start': {
            const reasoningSegment = { type: 'reasoning', id: (streamEvent as any).item_id, output_index: (streamEvent as any).output_index, sequence_number: (streamEvent as any).sequence_number, parts: [] as ReasoningPart[], streaming: true } as any;
            currentEvent.segments.unshift(reasoningSegment as any);
            break; }
          case 'reasoning_summary_text_delta': {
            const rs = currentEvent.segments.find(s => s.type === 'reasoning') as any;
            if (rs) {
              const partIndex = (streamEvent as any).summary_index ?? 0;
              if (!rs.parts[partIndex]) rs.parts[partIndex] = { summary_index: partIndex, type: 'summary_text', text: '', sequence_number: (streamEvent as any).sequence_number, is_complete: false, created_at: Date.now() } as ReasoningPart;
              rs.parts[partIndex].text += ((streamEvent as any).delta?.text || (streamEvent as any).text || '');
            }
            break; }
          case 'reasoning_summary_text_done': {
            const rs = currentEvent.segments.find(s => s.type === 'reasoning') as any;
            if (rs) {
              const partIndex = (streamEvent as any).summary_index ?? 0;
              if (!rs.parts[partIndex]) rs.parts[partIndex] = { summary_index: partIndex, type: 'summary_text', text: '', sequence_number: (streamEvent as any).sequence_number, is_complete: true, created_at: Date.now() } as ReasoningPart;
              rs.parts[partIndex].is_complete = true;
            }
            break; }
          case 'mcp_tool_start': {
            const segment: Segment = { type: 'tool_call', id: ((streamEvent as any).tool_id || generateToolCallId()) as ToolCallId, name: (streamEvent as any).tool_name || 'mcp_tool', args: (streamEvent as any).arguments || {}, server_type: 'remote_mcp', server_label: (streamEvent as any).server_label, display_name: (streamEvent as any).display_name, sequence_number: (streamEvent as any).sequence_number, output_index: (streamEvent as any).output_index } as any;
            currentEvent.segments.push(segment);
            yield { type: 'segment', data: { segment, segmentIndex: currentEvent.segments.length - 1 } } as any;
            break; }
          case 'mcp_tool_arguments_delta': {
            const toolId = (streamEvent as any).tool_id as string;
            const segIndex = currentEvent.segments.findIndex(s => s.type === 'tool_call' && (s as any).id === toolId);
            if (segIndex >= 0) {
              const seg = currentEvent.segments[segIndex] as any;
              const prev = typeof seg.args === 'string' ? seg.args : JSON.stringify(seg.args || {});
              const next = (prev || '') + ((streamEvent as any).arguments || '');
              try { seg.args = JSON.parse(next); } catch { seg.args = next; }
              yield { type: 'segment', data: { segment: seg, segmentIndex: segIndex } } as any;
            }
            break; }
          case 'mcp_tool_finalized': {
            const toolId = (streamEvent as any).tool_id as string;
            const segIndex = currentEvent.segments.findIndex(s => s.type === 'tool_call' && (s as any).id === toolId);
            if (segIndex >= 0) { const seg = currentEvent.segments[segIndex] as any; yield { type: 'segment', data: { segment: seg, segmentIndex: segIndex } } as any; }
            break; }
          case 'mcp_tool_complete': {
            // handled by server when tool result is returned; no-op here
            break; }
          default:
            // pass through unhandled items for debugging/logging upstream
            break;
        }
      }
    } catch (error) {
      throw this.handleProviderError(error);
    }
  }
  
  private convertEventsToInputItems(events: Event[]): ResponsesInputItem[] {
    const items: ResponsesInputItem[] = [];
    const storedReasoningSegments: Array<{ id: string }> = [];
    for (const event of events) {
      if (event.role === 'system') {
        items.push({ id: crypto.randomUUID(), type: 'message', role: 'system', content: [{ type: 'input_text', text: (event.segments.find(s => s.type === 'text') as any)?.text || '' }] });
        continue;
      }
      if (event.role === 'user') {
        items.push({ id: crypto.randomUUID(), type: 'message', role: 'user', content: [{ type: 'input_text', text: (event.segments.find(s => s.type === 'text') as any)?.text || '' }] });
        continue;
      }
      if (event.role === 'assistant') {
        let messageId = (event.segments.find(s => (s as any).id) as any)?.id || crypto.randomUUID();
        for (const segment of event.segments) {
          if (segment.type === 'reasoning') {
            storedReasoningSegments.push({ id: (segment as any).id });
            items.push({ id: (segment as any).id, type: 'reasoning', summary: (segment as any).combined_text ? [{ type: 'text', text: (segment as any).combined_text }] : undefined });
          } else if (segment.type === 'text') {
            items.push({ id: messageId, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: (segment as any).text }] });
          } else if (segment.type === 'tool_call') {
            const mcpCall: any = { id: (segment as any).id, type: 'mcp_call', name: (segment as any).name, arguments: JSON.stringify((segment as any).args), server_label: (segment as any).server_label || 'default' };
            if ((segment as any).output !== undefined) mcpCall.output = typeof (segment as any).output === 'string' ? (segment as any).output : JSON.stringify((segment as any).output);
            if ((segment as any).error) mcpCall.error = (segment as any).error;
            items.push(mcpCall);
          }
        }
      } else if (event.role === 'tool') {
        const toolResult = event.segments[0] as any;
        if (toolResult.type === 'tool_result') {
          items.push({ id: toolResult.id, type: 'mcp_call', output: typeof toolResult.output === 'string' ? toolResult.output : JSON.stringify(toolResult.output), error: toolResult.error });
        }
      }
    }
    return items;
  }
  
  private convertResponseToEvent(response: any): Event {
    const segments: Event['segments'] = [];
    if (response.output) {
      for (const output of response.output) {
        if (output.type === 'text' && output.content) {
          segments.push({ type: 'text', text: output.content } as any);
        } else if (output.type === 'mcp_call') {
          segments.push({ type: 'tool_call', id: (output.id || crypto.randomUUID()) as ToolCallId, name: output.name, args: output.arguments ? JSON.parse(output.arguments) : {}, server_label: output.server_label } as any);
        }
      }
    }
    if (response.reasoning_content) {
      segments.unshift({ type: 'reasoning', id: response.id, output_index: 0, sequence_number: 0, parts: [{ summary_index: 0, type: 'summary_text', text: response.reasoning_content, sequence_number: 0, is_complete: true, created_at: Date.now() }] } as any);
    }
    return { id: response.id, role: 'assistant', segments, ts: Date.now() } as any;
  }
}
