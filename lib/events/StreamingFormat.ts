// Unified streaming format for consistent SSE events
import { Event, Segment } from '@budchat/events';
import { AppError } from '@/lib/errors';

export interface StreamingEvent {
  type: 'event_start' | 'segment' | 'event_complete' | 'error' | 'complete';
  data?: {
    event?: Event;
    segment?: Segment;
    segmentIndex?: number;
    error?: {
      code: string;
      message: string;
    };
  };
  metadata?: {
    model?: string;
    conversationId?: string;
    timestamp?: number;
  };
}

/**
 * Unified streaming format handler
 */
export class StreamingFormat {
  private encoder = new TextEncoder();
  
  /**
   * Format a streaming event for SSE
   */
  formatSSE(event: StreamingEvent): string {
    return `data: ${JSON.stringify(event)}\n\n`;
  }
  
  /**
   * Format as encoded bytes for streaming
   */
  formatBytes(event: StreamingEvent): Uint8Array {
    return this.encoder.encode(this.formatSSE(event));
  }
  
  /**
   * Create event start message
   */
  eventStart(event: Event, metadata?: StreamingEvent['metadata']): StreamingEvent {
    return {
      type: 'event_start',
      data: { event },
      metadata: {
        timestamp: Date.now(),
        ...metadata
      }
    };
  }
  
  /**
   * Create segment update message
   */
  segmentUpdate(segment: Segment, segmentIndex: number, eventId?: string): StreamingEvent {
    return {
      type: 'segment',
      data: { 
        segment,
        segmentIndex,
        event: eventId ? { id: eventId } as Event : undefined
      },
      metadata: {
        timestamp: Date.now()
      }
    };
  }
  
  /**
   * Create event complete message
   */
  eventComplete(event: Event): StreamingEvent {
    return {
      type: 'event_complete',
      data: { event },
      metadata: {
        timestamp: Date.now()
      }
    };
  }
  
  /**
   * Create error message
   */
  error(error: AppError | Error | string): StreamingEvent {
    let errorData: { code: string; message: string };
    
    if (error instanceof AppError) {
      errorData = {
        code: error.code,
        message: error.message
      };
    } else if (error instanceof Error) {
      errorData = {
        code: 'STREAM_ERROR',
        message: error.message
      };
    } else {
      errorData = {
        code: 'UNKNOWN_ERROR',
        message: String(error)
      };
    }
    
    return {
      type: 'error',
      data: { error: errorData },
      metadata: {
        timestamp: Date.now()
      }
    };
  }
  
  /**
   * Create completion message
   */
  done(metadata?: StreamingEvent['metadata']): StreamingEvent {
    return {
      type: 'complete',
      metadata: {
        timestamp: Date.now(),
        ...metadata
      }
    };
  }
  
  /**
   * Parse SSE data back to StreamingEvent
   */
  parseSSE(data: string): StreamingEvent | null {
    try {
      // Remove "data: " prefix if present
      const jsonStr = data.startsWith('data: ') ? data.slice(6).trim() : data.trim();
      if (!jsonStr || jsonStr === '[DONE]') return null;
      
      return JSON.parse(jsonStr) as StreamingEvent;
    } catch (e) {
      console.error('Failed to parse SSE data:', e);
      return null;
    }
  }
  
  /**
   * Create a transform stream for consistent formatting
   */
  createTransformStream(): TransformStream<StreamingEvent, Uint8Array> {
    return new TransformStream({
      transform: (event, controller) => {
        controller.enqueue(this.formatBytes(event));
      }
    });
  }
}
