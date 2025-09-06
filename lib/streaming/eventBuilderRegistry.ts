import { Event } from '@/state/eventChatStore';
import { toEventId } from '@/lib/types/branded';

const drafts = new Map<string, Event>(); // key: assistantEventId
const streamingMeta = new Map<string, { hasTextContent: boolean; preText: Event['segments']; postText: Event['segments'] }>();

export function setDraft(eventId: string, draft: Event) {
  drafts.set(eventId, draft);
}

export function getDraft(eventId: string): Event | undefined {
  return drafts.get(eventId);
}

export function clearDraft(eventId: string) {
  drafts.delete(eventId);
  streamingMeta.delete(eventId);
}

export function renameDraft(oldId: string, newId: string) {
  if (oldId === newId) return;
  const d = drafts.get(oldId);
  if (d) {
    drafts.delete(oldId);
    drafts.set(newId, { ...d, id: toEventId(newId) });
    try {
      if (process.env.NEXT_PUBLIC_STREAM_DEBUG === 'true' || process.env.NEXT_PUBLIC_RESPONSES_DEBUG === 'true') {
        // eslint-disable-next-line no-console
        console.debug('[STREAM][Draft] renameDraft', { from: oldId, to: newId });
      }
    } catch {}
  }
  const m = streamingMeta.get(oldId);
  if (m) {
    streamingMeta.delete(oldId);
    streamingMeta.set(newId, m);
  }
}

export function setStreamingMeta(eventId: string, meta: { hasTextContent: boolean; preText: Event['segments']; postText: Event['segments'] }) {
  streamingMeta.set(eventId, meta);
}

export function getStreamingMeta(eventId: string): { hasTextContent: boolean; preText: Event['segments']; postText: Event['segments'] } | undefined {
  return streamingMeta.get(eventId);
}
