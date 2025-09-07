import { ProgressState } from './types/progress';
import { EventId, ToolCallId, ConversationId, generateEventId } from './types/branded';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type Segment =
  | { type: 'text'; text: string; id?: string; sequence_number?: number; output_index?: number; citations?: Array<{ url: string; title: string; start_index: number; end_index: number }>; }
  | { type: 'tool_call'; id: ToolCallId; name: string; args: object; started_at?: number; completed_at?: number; server_label?: string; display_name?: string; server_type?: string; output_index?: number; sequence_number?: number; output?: object; error?: string }
  | { type: 'tool_result'; id: ToolCallId; output: object; error?: string; started_at?: number; completed_at?: number }
  | { type: 'reasoning'; id: string; output_index: number; sequence_number: number; parts: ReasoningPart[]; combined_text?: string; effort_level?: 'low' | 'medium' | 'high'; reasoning_tokens?: number; streaming?: boolean; streaming_part_index?: number; started_at?: number; completed_at?: number }
  | { type: 'web_search_call'; id: string; output_index: number; sequence_number: number; status: 'in_progress' | 'searching' | 'completed' | 'failed'; started_at?: number; completed_at?: number; streaming?: boolean }
  | { type: 'code_interpreter_call'; id: string; output_index: number; sequence_number: number; status: 'in_progress' | 'interpreting' | 'completed' | 'failed'; code?: string; started_at?: number; completed_at?: number; streaming?: boolean };

export interface ReasoningPart { summary_index: number; type: 'summary_text'; text: string; sequence_number: number; is_complete: boolean; created_at: number; }
export interface ReasoningData { item_id: string; output_index: number; sequence_number?: number; parts: Record<number, ReasoningPart>; combined_text?: string; effort_level?: 'low' | 'medium' | 'high'; reasoning_tokens?: number; streaming_part_index?: number; }
export interface ResponseMetadata { total_output_items?: number; completion_status?: 'complete' | 'partial' | 'interrupted'; usage?: { reasoning_tokens?: number; completion_tokens?: number; total_tokens?: number }; openai_response_id?: string; model?: string }

export interface Event { id: EventId; role: Role; segments: Segment[]; ts: number; response_metadata?: ResponseMetadata; progressState?: ProgressState; reasoning?: ReasoningData }
export interface DatabaseEvent extends Event { conversation_id: ConversationId; order_key: string; created_at: string }
export interface ToolCall { id: ToolCallId; name: string; args: object; _rawArgs?: string }
export interface ToolResult { id: ToolCallId; output: object; error?: string }

export class EventLog {
  private events: Event[] = [];
  constructor(initialEvents: Event[] = []) { this.events = [...initialEvents]; }
  getEvents(): Event[] { return this.events.map(e => ({ ...e, segments: e.segments.map(s => ({ ...(s as any) })) })); }
  addEvent(event: Event): void {
    const existingEvent = this.events.find(e => e.id === event.id);
    if (existingEvent) { console.error('🚨 DUPLICATE EVENT ID being added to EventLog:', { id: event.id, role: event.role, existingRole: existingEvent.role, stackTrace: new Error().stack }); }
    this.events.push(event);
  }
  updateEvent(event: Event): boolean { const i = this.events.findIndex(e => e.id === event.id); if (i >= 0) { this.events[i] = event; return true; } console.warn('⚠️ Event not found for update:', { id: event.id, role: event.role }); return false; }
  getUnresolvedToolCalls(): ToolCall[] { const calls: Record<string, ToolCall> = {}; const resolved: Record<string, true> = {}; for (const e of this.getEvents()) { for (const s of e.segments) { if (s.type === 'tool_call') calls[(s as any).id] = { id: (s as any).id, name: (s as any).name, args: (s as any).args }; if (s.type === 'tool_result') resolved[(s as any).id] = true; } } return Object.values(calls).filter(c => !resolved[c.id]); }
  toProviderMessages(provider: 'openai' | 'anthropic'): unknown[] {
    if (provider === 'anthropic') {
      const messages: Array<{ role: string; content: Array<any> | string }> = [];
      for (const event of this.getEvents()) {
        if (event.role === 'system') continue;
        const blocks: any[] = [];
        for (const segment of (event.segments || [])) {
          switch ((segment as any).type) {
            case 'text': if ((segment as any).text) blocks.push({ type: 'text', text: (segment as any).text }); break;
            case 'tool_call': blocks.push({ type: 'tool_use', id: (segment as any).id, name: (segment as any).name, input: (segment as any).args }); break;
            case 'tool_result': blocks.push({ type: 'tool_result', tool_use_id: (segment as any).id, content: JSON.stringify((segment as any).output) }); break;
          }
        }
        if (blocks.length > 0) messages.push({ role: event.role, content: blocks });
      }
      return messages;
    }
    const messages: any[] = [];
    for (const event of this.getEvents()) {
      if (event.role === 'tool') {
        for (const segment of event.segments) {
          if ((segment as any).type === 'tool_result') {
            let toolContent = JSON.stringify((segment as any).output);
            const MAX_TOOL_RESULT_LENGTH = 30000;
            if (toolContent.length > MAX_TOOL_RESULT_LENGTH) { console.warn(`⚠️ [EventLog] Tool result truncated for OpenAI from ${toolContent.length} to ${MAX_TOOL_RESULT_LENGTH} characters`); toolContent = toolContent.substring(0, MAX_TOOL_RESULT_LENGTH) + '... [truncated]'; }
            messages.push({ role: 'tool', tool_call_id: (segment as any).id, content: toolContent });
          }
        }
        continue;
      }
      let content = '';
      const tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
      const segments = event.segments || [];
      for (const segment of segments) {
        switch ((segment as any).type) {
          case 'text': if ((segment as any).text) content += (segment as any).text; break;
          case 'tool_call': tool_calls.push({ id: (segment as any).id, type: 'function', function: { name: (segment as any).name, arguments: JSON.stringify((segment as any).args) } }); break;
          case 'tool_result': break;
        }
      }
      if (event.role === 'assistant' && !content && tool_calls.length === 0) continue;
      const message: Record<string, unknown> = { role: event.role, content: content || '' };
      if (tool_calls.length > 0) (message as any).tool_calls = tool_calls;
      messages.push(message);
    }
    return messages;
  }

  // Extract concatenated system message text
  getSystemMessage(): string {
    const systemTexts: string[] = [];
    for (const event of this.getEvents()) {
      if (event.role === 'system') {
        for (const segment of event.segments) {
          if ((segment as any).type === 'text' && (segment as any).text) {
            systemTexts.push((segment as any).text as string);
          }
        }
      }
    }
    return systemTexts.join('\n\n');
  }
}

export function createTextEvent(role: Role, text: string, timestamp?: number): Event { return { id: generateEventId(), role, segments: [{ type: 'text', text }], ts: timestamp || Date.now() }; }
export function createToolCallEvent(id: ToolCallId, name: string, args: object, timestamp?: number): Event { return { id: generateEventId(), role: 'assistant', segments: [{ type: 'tool_call', id, name, args }], ts: timestamp || Date.now() }; }
export function createToolResultEvent(id: ToolCallId, output: object, timestamp?: number): Event { return { id: generateEventId(), role: 'tool', segments: [{ type: 'tool_result', id, output }], ts: timestamp || Date.now() }; }
export function createReasoningSegment(id: string, output_index: number, sequence_number: number, parts: ReasoningPart[], options?: { combined_text?: string; effort_level?: 'low' | 'medium' | 'high'; reasoning_tokens?: number; streaming?: boolean }): Segment { return { type: 'reasoning', id, output_index, sequence_number, parts, combined_text: options?.combined_text, effort_level: options?.effort_level, reasoning_tokens: options?.reasoning_tokens, streaming: options?.streaming }; }
export function sortSegmentsBySequence(segments: Segment[]): Segment[] { return segments.sort((a, b) => { const aSeq = 'sequence_number' in a ? (a as any).sequence_number || 0 : 0; const bSeq = 'sequence_number' in b ? (b as any).sequence_number || 0 : 0; return aSeq - bSeq; }); }
