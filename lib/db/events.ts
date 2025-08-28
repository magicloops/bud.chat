// Database layer for events

import { createClient } from '@/lib/supabase/server';
import { Event, DatabaseEvent } from '@/lib/types/events';
import { ConversationId } from '@/lib/types/branded';
import { generateKeyBetween } from 'fractional-indexing';

export interface SaveEventOptions {
  conversationId: ConversationId;
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
  
  // Helper: detect unique constraint violation (race on last-key append)
  const isUniqueViolation = (err: unknown) => {
    // Supabase/PG uses SQLSTATE 23505 for unique violations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (err as any)?.code || (err as any)?.details?.code;
    return code === '23505';
  };
  
  // Generate order key if not provided
  let orderKey = options.orderKey ?? null;
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
    order_key: orderKey,
    reasoning: event.reasoning
  };
  
  // Try to insert; on unique violation, refetch last key, regenerate once, and retry.
  let { data, error } = await supabase
    .from('events')
    .insert([dbEvent])
    .select()
    .single();
  
  if (error && isUniqueViolation(error)) {
    // Another writer likely appended at the same time.
    // Refetch last key and retry once to get a fresh key.
    const { data: lastEvent } = await supabase
      .from('events')
      .select('order_key')
      .eq('conversation_id', options.conversationId)
      .order('order_key', { ascending: false })
      .limit(1)
      .single();
    const retryKey = generateKeyBetween(lastEvent?.order_key || null, null);
    dbEvent.order_key = retryKey;
    ({ data, error } = await supabase
      .from('events')
      .insert([dbEvent])
      .select()
      .single());
  }
  
  if (error) {
    throw new Error(`Failed to save event: ${error.message}`);
  }
  
  return data;
}

/**
 * Get all events for a conversation
 */
export async function getConversationEvents(conversationId: string): Promise<DatabaseEvent[]> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('order_key', { ascending: true });
  
  if (error) {
    throw new Error(`Failed to get conversation events: ${error.message}`);
  }
  
  // Return full database events (includes order_key, conversation_id, created_at)
  return data as DatabaseEvent[];
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
    ts: data.ts,
    reasoning: data.reasoning || undefined
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
    ts: dbEvent.ts,
    reasoning: dbEvent.reasoning || undefined
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
  // Helper: detect unique constraint violation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isUniqueViolation = (err: any) => err?.code === '23505' || err?.details?.code === '23505';
  
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
      order_key: orderKey,
      reasoning: event.reasoning
    };
  });
  
  // Try batch insert first for performance.
  let { data, error } = await supabase
    .from('events')
    .insert(dbEvents)
    .select();
  
  if (error && isUniqueViolation(error)) {
    // Fallback: insert sequentially with per-item retry after refetching last key.
    const inserted: DatabaseEvent[] = [] as unknown as DatabaseEvent[];
    let currentLastKey: string | null = lastEvent?.order_key || null;
    for (const ev of events) {
      // Generate next key from the latest committed key
      const key = generateKeyBetween(currentLastKey, null);
      const dbEvent = {
        id: ev.id,
        conversation_id: conversationId,
        role: ev.role,
        segments: ev.segments,
        ts: ev.ts,
        order_key: key,
        reasoning: ev.reasoning
      };
      let insertRes = await supabase.from('events').insert([dbEvent]).select().single();
      if (insertRes.error && isUniqueViolation(insertRes.error)) {
        // Another writer raced us; refetch last and retry once
        const { data: lastEvt } = await supabase
          .from('events')
          .select('order_key')
          .eq('conversation_id', conversationId)
          .order('order_key', { ascending: false })
          .limit(1)
          .single();
        const retryKey = generateKeyBetween(lastEvt?.order_key || null, null);
        dbEvent.order_key = retryKey;
        insertRes = await supabase.from('events').insert([dbEvent]).select().single();
      }
      if (insertRes.error) {
        throw new Error(`Failed to save event in fallback: ${insertRes.error.message}`);
      }
      // Update last key to the one we just committed
      currentLastKey = (insertRes.data as DatabaseEvent).order_key;
      inserted.push(insertRes.data as DatabaseEvent);
    }
    return inserted;
  }
  
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
    ts: dbEvent.ts,
    reasoning: dbEvent.reasoning || undefined
  }));
}
