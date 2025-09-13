import { Event, DatabaseEvent } from '@budchat/events';
import { ConversationId, WorkspaceId, BudId, generateConversationId } from '@budchat/events';
import { Bud, Database } from '@/lib/types';
import { generateKeyBetween } from 'fractional-indexing';

export function getPostgrestErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { code?: string; details?: unknown };
  const details = (e.details as { code?: string } | null | undefined);
  return e.code ?? details?.code ?? undefined;
}

export async function loadConversationEvents(
  supabase: any,
  conversationId: ConversationId
): Promise<Event[]> {
  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('order_key', { ascending: true });

  if (error) {
    throw new Error('Failed to load conversation events');
  }

  return (events || []).map((e: Database['public']['Tables']['events']['Row']) => ({
    id: e.id,
    role: e.role,
    segments: e.segments as unknown as Event['segments'],
    ts: e.ts,
    response_metadata: (e as any).response_metadata
  }));
}

export async function getConversationEvents(
  supabase: any,
  conversationId: string
): Promise<DatabaseEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('order_key', { ascending: true });
  if (error) throw new Error(`Failed to get conversation events: ${error.message}`);
  return data as DatabaseEvent[];
}

export async function saveEvents(
  supabase: any,
  events: Event[],
  conversationId: ConversationId,
  previousOrderKey?: string | null
): Promise<string | null> {
  let orderKey: string | null | undefined = previousOrderKey ?? null;
  const eventInserts: Omit<DatabaseEvent, 'created_at'>[] = [] as any;

  for (const event of events) {
    orderKey = generateKeyBetween(orderKey, null);
    eventInserts.push({
      id: event.id,
      conversation_id: conversationId,
      role: event.role,
      segments: event.segments,
      ts: event.ts,
      order_key: orderKey,
      response_metadata: (event as any).response_metadata
    } as any);
  }

  if (eventInserts.length > 0) {
    const { error } = await supabase.from('events').insert(eventInserts);
    const code = getPostgrestErrorCode(error);
    if (error && code !== '23505') {
      throw new Error('Failed to save events');
    }
    if (error && code === '23505') {
      let currentLastKey: string | null = previousOrderKey ?? null;
      for (const e of events) {
        const key = generateKeyBetween(currentLastKey, null);
        const row: Omit<DatabaseEvent, 'created_at'> = {
          id: e.id,
          conversation_id: conversationId,
          role: e.role,
          segments: e.segments,
          ts: e.ts,
          order_key: key,
          response_metadata: (e as any).response_metadata
        } as any;
        let ins = await supabase.from('events').insert([row]).select('order_key').single();
        let icode = getPostgrestErrorCode(ins.error);
        if (ins.error && icode === '23505') {
          const { data: last } = await supabase
            .from('events')
            .select('order_key')
            .eq('conversation_id', conversationId)
            .order('order_key', { ascending: false })
            .limit(1)
            .single();
          row.order_key = generateKeyBetween(last?.order_key || null, null);
          ins = await supabase.from('events').insert([row]).select('order_key').single();
          icode = getPostgrestErrorCode(ins.error);
        }
        if (ins.error) {
          throw new Error('Failed to save event during fallback');
        }
        currentLastKey = ins.data?.order_key || row.order_key;
        orderKey = currentLastKey;
      }
    }
  }

  return orderKey ?? null;
}

export async function saveEvent(
  supabase: any,
  event: Event,
  options: { conversationId: string; orderKey?: string | null }
): Promise<DatabaseEvent> {
  const isUniqueViolation = (err: any) => err?.code === '23505' || err?.details?.code === '23505';
  let orderKey = options.orderKey ?? null;
  if (!orderKey) {
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
    conversation_id: options.conversationId as any,
    role: event.role,
    segments: event.segments,
    ts: event.ts,
    order_key: orderKey,
    response_metadata: (event as any).response_metadata
  } as any;
  let { data, error } = await supabase.from('events').insert([dbEvent]).select().single();
  if (error && isUniqueViolation(error)) {
    const { data: lastEvent } = await supabase
      .from('events')
      .select('order_key')
      .eq('conversation_id', options.conversationId)
      .order('order_key', { ascending: false })
      .limit(1)
      .single();
    const retryKey = generateKeyBetween(lastEvent?.order_key || null, null);
    dbEvent.order_key = retryKey as any;
    ({ data, error } = await supabase.from('events').insert([dbEvent]).select().single());
  }
  if (error) throw new Error(`Failed to save event: ${error.message}`);
  return data as DatabaseEvent;
}

export async function updateEventSegments(
  supabase: any,
  eventId: string,
  segments: Event['segments']
): Promise<void> {
  const { error } = await supabase.from('events').update({ segments }).eq('id', eventId);
  if (error) throw new Error(`Failed to update event segments: ${error.message}`);
}

export async function getLatestEvent(
  supabase: any,
  conversationId: string
): Promise<Event | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('order_key', { ascending: false })
    .limit(1)
    .single();
  if (error) {
    if ((error as any).code === 'PGRST116') return null;
    throw new Error(`Failed to get latest event: ${error.message}`);
  }
  return { id: data.id, role: data.role, segments: data.segments, ts: data.ts, reasoning: (data as any).reasoning || undefined } as Event;
}

export async function getLastOrderKey(
  supabase: any,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('events')
    .select('order_key')
    .eq('conversation_id', conversationId)
    .order('order_key', { ascending: false })
    .limit(1)
    .single();
  if (error) {
    // If no rows (PGRST116), return null; otherwise throw
    const code = getPostgrestErrorCode(error);
    if (code === 'PGRST116') return null;
    throw new Error(`Failed to get last order key: ${error.message}`);
  }
  return data?.order_key || null;
}

export async function deleteEvent(
  supabase: any,
  eventId: string
): Promise<void> {
  const { error } = await supabase.from('events').delete().eq('id', eventId);
  if (error) throw new Error(`Failed to delete event: ${error.message}`);
}

export async function getEventsByRole(
  supabase: any,
  conversationId: string,
  role: Event['role']
): Promise<Event[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('role', role)
    .order('order_key', { ascending: true });
  if (error) throw new Error(`Failed to get events by role: ${error.message}`);
  return (data || []).map((dbEvent: any) => ({ id: dbEvent.id, role: dbEvent.role, segments: dbEvent.segments, ts: dbEvent.ts, reasoning: dbEvent.reasoning || undefined }));
}

export async function getEventCount(
  supabase: any,
  conversationId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);
  if (error) throw new Error(`Failed to get event count: ${error.message}`);
  return count || 0;
}

export async function getEventsByTimeRange(
  supabase: any,
  conversationId: string,
  startTs: number,
  endTs: number
): Promise<Event[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('conversation_id', conversationId)
    .gte('ts', startTs)
    .lte('ts', endTs)
    .order('order_key', { ascending: true });
  if (error) throw new Error(`Failed to get events by time range: ${error.message}`);
  return (data || []).map((dbEvent: any) => ({ id: dbEvent.id, role: dbEvent.role, segments: dbEvent.segments, ts: dbEvent.ts, reasoning: dbEvent.reasoning || undefined }));
}

export async function updateToolSegmentTiming(
  supabase: any,
  eventId: string,
  toolId: string,
  started_at?: number,
  completed_at?: number
): Promise<void> {
  const { data: row } = await supabase
    .from('events')
    .select('segments')
    .eq('id', eventId)
    .single();
  if (!row?.segments) return;
  const segs = (row.segments as any[]).map(s => ({ ...s }));
  const idx = segs.findIndex(s => s.type === 'tool_call' && s.id === toolId);
  if (idx === -1) return;
  const nowTs = completed_at || Date.now();
  const startTs = segs[idx].started_at || started_at || Date.now();
  segs[idx] = { ...segs[idx], started_at: startTs, completed_at: nowTs };
  await supabase.from('events').update({ segments: segs }).eq('id', eventId);
}

export async function updateReasoningSegmentTiming(
  supabase: any,
  eventId: string,
  reasoningId: string,
  started_at?: number,
  completed_at?: number
): Promise<void> {
  const { data: row } = await supabase
    .from('events')
    .select('segments')
    .eq('id', eventId)
    .single();
  if (!row?.segments) return;
  const segs = (row.segments as any[]).map(s => ({ ...s }));
  const idx = segs.findIndex(s => s.type === 'reasoning' && s.id === reasoningId);
  if (idx === -1) return;
  const nowTs = completed_at || Date.now();
  const startTs = segs[idx].started_at || started_at || Date.now();
  segs[idx] = { ...segs[idx], started_at: startTs, completed_at: nowTs };
  await supabase.from('events').update({ segments: segs }).eq('id', eventId);
}

export async function createConversation(
  supabase: any,
  workspaceId: WorkspaceId,
  budId?: BudId
): Promise<{ conversationId: ConversationId; bud?: Bud }> {
  let bud: Bud | null = null;
  if (budId) {
    const { data, error } = await supabase
      .from('buds')
      .select('*')
      .eq('id', budId)
      .single();
    if (data && !error) bud = data as Bud;
  }
  const conversationId = generateConversationId() as ConversationId;
  const { error } = await supabase
    .from('conversations')
    .insert({ id: conversationId, workspace_id: workspaceId, source_bud_id: budId || null, created_at: new Date().toISOString() });
  if (error) throw new Error('Failed to create conversation');
  return { conversationId, bud: bud || undefined };
}

/**
 * Deletes a conversation and all of its events in a single helper.
 * Assumes caller has already validated access permissions.
 */
export async function deleteConversationWithEvents(
  supabase: any,
  conversationId: string
): Promise<void> {
  // Delete events first (no cascade)
  const { error: eventsDeleteError } = await supabase
    .from('events')
    .delete()
    .eq('conversation_id', conversationId);
  if (eventsDeleteError) {
    throw new Error(`Error deleting events: ${eventsDeleteError.message}`);
  }

  // Delete the conversation
  const { error: deleteError } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId);
  if (deleteError) {
    throw new Error(`Error deleting conversation: ${deleteError.message}`);
  }
}
