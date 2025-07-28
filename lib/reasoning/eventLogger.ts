// Reasoning event logger for debugging and validation
// Ensures no reasoning events are missed and tracks unknown event types

export class ReasoningEventLogger {
  private static loggedEvents: Set<string> = new Set();
  private static unknownEvents: Array<{ type: string, data: unknown, timestamp: number }> = [];
  
  static logEvent(event: unknown): void {
    const eventData = event as { type?: string; sequence_number?: number; item_id?: string };
    const eventId = `${eventData.type}-${eventData.sequence_number}-${eventData.item_id}`;
    
    if (this.loggedEvents.has(eventId)) {
      console.warn('🔄 Duplicate reasoning event:', eventId);
      return;
    }
    
    this.loggedEvents.add(eventId);
    
    const knownTypes = [
      // Raw OpenAI API event types
      'response.reasoning_summary_part.added',
      'response.reasoning_summary_part.done',
      'response.reasoning_summary_text.delta',
      'response.reasoning_summary_text.done',
      'response.reasoning_summary.delta',
      'response.reasoning_summary.done',
      // Transformed event types (what we actually use)
      'reasoning_summary_part_added',
      'reasoning_summary_part_done',
      'reasoning_summary_text_delta',
      'reasoning_summary_text_done',
      'reasoning_summary_delta',
      'reasoning_summary_done'
    ];
    
    if (!knownTypes.includes(eventData.type || '')) {
      this.unknownEvents.push({
        type: eventData.type || 'unknown',
        data: event,
        timestamp: Date.now()
      });
      console.warn('🚨 Unknown reasoning event type:', eventData.type, event);
    }
    // Removed verbose logging of every reasoning event to reduce noise
  }
  
  static getUnknownEvents(): Array<{ type: string, data: unknown, timestamp: number }> {
    return [...this.unknownEvents];
  }
  
  static exportEventLog(): string {
    return JSON.stringify({
      processedEvents: Array.from(this.loggedEvents),
      unknownEvents: this.unknownEvents,
      timestamp: Date.now()
    }, null, 2);
  }
  
  static clearLogs(): void {
    this.loggedEvents.clear();
    this.unknownEvents.length = 0;
  }
  
  static getStats(): { processed: number, unknown: number } {
    return {
      processed: this.loggedEvents.size,
      unknown: this.unknownEvents.length
    };
  }
}