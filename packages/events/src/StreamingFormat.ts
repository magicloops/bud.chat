import { Event, Segment } from './events';

export interface StreamingEvent {
  type: 'event_start' | 'segment' | 'event_complete' | 'error' | 'complete';
  data?: {
    event?: Event;
    segment?: Segment;
    segmentIndex?: number;
    error?: { code: string; message: string };
  };
  metadata?: { model?: string; conversationId?: string; timestamp?: number };
}

export class StreamingFormat {
  private encoder = new TextEncoder();
  formatSSE(event: StreamingEvent): string { return `data: ${JSON.stringify(event)}\n\n`; }
  formatBytes(event: StreamingEvent): Uint8Array { return this.encoder.encode(this.formatSSE(event)); }
  eventStart(event: Event, metadata?: StreamingEvent['metadata']): StreamingEvent { return { type: 'event_start', data: { event }, metadata: { timestamp: Date.now(), ...metadata } }; }
  segmentUpdate(segment: Segment, segmentIndex: number, eventId?: string): StreamingEvent { return { type: 'segment', data: { segment, segmentIndex, event: eventId ? { id: eventId } as Event : undefined }, metadata: { timestamp: Date.now() } }; }
  eventComplete(event: Event): StreamingEvent { return { type: 'event_complete', data: { event }, metadata: { timestamp: Date.now() } }; }
  error(error: unknown): StreamingEvent { const e = typeof error === 'string' ? { code: 'UNKNOWN_ERROR', message: error } : { code: (error as any)?.code ?? 'STREAM_ERROR', message: (error as any)?.message ?? String(error) }; return { type: 'error', data: { error: e }, metadata: { timestamp: Date.now() } }; }
  done(metadata?: StreamingEvent['metadata']): StreamingEvent { return { type: 'complete', metadata: { timestamp: Date.now(), ...metadata } }; }
  parseSSE(data: string): StreamingEvent | null { try { const jsonStr = data.startsWith('data: ') ? data.slice(6).trim() : data.trim(); if (!jsonStr || jsonStr === '[DONE]') return null; return JSON.parse(jsonStr) as StreamingEvent; } catch { return null; } }
  createTransformStream(): TransformStream<StreamingEvent, Uint8Array> { return new TransformStream({ transform: (event, controller) => controller.enqueue(this.formatBytes(event)) }); }
}

