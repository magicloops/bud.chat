// Database layer for events

import { createClient } from '@/lib/supabase/server';
import { Event, DatabaseEvent } from '@/lib/types/events';
import { generateKeyBetween } from 'fractional-indexing';

export interface SaveEventOptions {
  conversationId: string;
  orderKey?: string;
}

/**
 * Save an event to the database
 */
export async function saveEvent(
  event: Event,
  options: SaveEventOptions
): Promise<DatabaseEvent> {
  const supabase = await createClient();
  
  // Generate order key if not provided
  let orderKey = options.orderKey;
  if (!orderKey) {
    // Get the last order key for this conversation
    const { data: lastEvent } = await supabase
      .from('events')
      .select('order_key')
      .eq('conversation_id', options.conversationId)
      .order('order_key', { ascending: false })
      .limit(1)
      .single();
    
    orderKey = generateKeyBetween(lastEvent?.order_key || null, null);
  }
  
  const dbEvent: Omit<DatabaseEvent, 'created_at'> = {
    id: event.id,
    conversation_id: options.conversationId,
    role: event.role,
    segments: event.segments,
    ts: event.ts,
    order_key: orderKey
  };
  
  const { data, error } = await supabase
    .from('events')
    .insert([dbEvent])
    .select()
    .single();
  
  if (error) {
    throw new Error(`Failed to save event: ${error.message}`);
  }
  
  return data;
}

/**
 * Get all events for a conversation
 */
export async function getConversationEvents(conversationId: string): Promise<Event[]> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('order_key', { ascending: true });
  
  if (error) {
    throw new Error(`Failed to get conversation events: ${error.message}`);
  }
  
  // Convert database events to events
  return data.map(dbEvent => ({
    id: dbEvent.id,
    role: dbEvent.role,
    segments: dbEvent.segments,
    ts: dbEvent.ts
  }));
}

/**
 * Update event segments (for streaming updates)
 */
export async function updateEventSegments(
  eventId: string,
  segments: Event['segments']
): Promise<void> {
  const supabase = await createClient();
  
  const { error } = await supabase
    .from('events')
    .update({ segments })
    .eq('id', eventId);
  
  if (error) {
    throw new Error(`Failed to update event segments: ${error.message}`);
  }
}

/**
 * Get the latest event for a conversation
 */
export async function getLatestEvent(conversationId: string): Promise<Event | null> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('order_key', { ascending: false })
    .limit(1)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      // No rows found
      return null;
    }
    throw new Error(`Failed to get latest event: ${error.message}`);
  }
  
  return {
    id: data.id,
    role: data.role,
    segments: data.segments,
    ts: data.ts
  };
}

/**
 * Delete an event
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const supabase = await createClient();
  
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId);
  
  if (error) {
    throw new Error(`Failed to delete event: ${error.message}`);
  }
}

/**
 * Get events by role
 */
export async function getEventsByRole(
  conversationId: string,
  role: Event['role']
): Promise<Event[]> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('role', role)
    .order('order_key', { ascending: true });
  
  if (error) {
    throw new Error(`Failed to get events by role: ${error.message}`);
  }
  
  return data.map(dbEvent => ({
    id: dbEvent.id,
    role: dbEvent.role,
    segments: dbEvent.segments,
    ts: dbEvent.ts
  }));
}

/**
 * Get events with tool calls that need results
 */
export async function getPendingToolCalls(conversationId: string): Promise<Array<{
  eventId: string;
  toolCallId: string;
  toolName: string;
  toolArgs: object;
}>> {
  const events = await getConversationEvents(conversationId);
  const pendingCalls: Array<{
    eventId: string;
    toolCallId: string;
    toolName: string;
    toolArgs: object;
  }> = [];
  
  const toolResults = new Set<string>();
  
  // First pass: collect all tool result IDs
  for (const event of events) {
    for (const segment of event.segments) {
      if (segment.type === 'tool_result') {
        toolResults.add(segment.id);
      }
    }
  }
  
  // Second pass: find tool calls without results
  for (const event of events) {
    for (const segment of event.segments) {
      if (segment.type === 'tool_call' && !toolResults.has(segment.id)) {
        pendingCalls.push({
          eventId: event.id,
          toolCallId: segment.id,
          toolName: segment.name,
          toolArgs: segment.args
        });
      }
    }
  }
  
  return pendingCalls;
}

/**
 * Batch save multiple events
 */
export async function saveEvents(
  events: Event[],
  conversationId: string
): Promise<DatabaseEvent[]> {
  if (events.length === 0) return [];
  
  const supabase = await createClient();
  
  // Get the last order key for this conversation
  const { data: lastEvent } = await supabase
    .from('events')
    .select('order_key')
    .eq('conversation_id', conversationId)
    .order('order_key', { ascending: false })
    .limit(1)
    .single();
  
  // Generate order keys for all events
  let lastOrderKey = lastEvent?.order_key || null;
  const dbEvents = events.map(event => {
    const orderKey = generateKeyBetween(lastOrderKey, null);
    lastOrderKey = orderKey;
    
    return {
      id: event.id,
      conversation_id: conversationId,
      role: event.role,
      segments: event.segments,
      ts: event.ts,
      order_key: orderKey
    };
  });
  
  const { data, error } = await supabase
    .from('events')
    .insert(dbEvents)
    .select();
  
  if (error) {
    throw new Error(`Failed to save events: ${error.message}`);
  }
  
  return data;
}

/**
 * Get event count for a conversation
 */
export async function getEventCount(conversationId: string): Promise<number> {
  const supabase = await createClient();
  
  const { count, error } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);
  
  if (error) {
    throw new Error(`Failed to get event count: ${error.message}`);
  }
  
  return count || 0;
}

/**
 * Get events in a specific time range
 */
export async function getEventsByTimeRange(
  conversationId: string,
  startTs: number,
  endTs: number
): Promise<Event[]> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('conversation_id', conversationId)
    .gte('ts', startTs)
    .lte('ts', endTs)
    .order('order_key', { ascending: true });
  
  if (error) {
    throw new Error(`Failed to get events by time range: ${error.message}`);
  }
  
  return data.map(dbEvent => ({
    id: dbEvent.id,
    role: dbEvent.role,
    segments: dbEvent.segments,
    ts: dbEvent.ts
  }));
}