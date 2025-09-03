import { Event } from '@/state/eventChatStore';

const drafts = new Map<string, Event>(); // key: assistantEventId

export function setDraft(eventId: string, draft: Event) {
  drafts.set(eventId, draft);
}

export function getDraft(eventId: string): Event | undefined {
  return drafts.get(eventId);
}

export function clearDraft(eventId: string) {
  drafts.delete(eventId);
}

export function renameDraft(oldId: string, newId: string) {
  if (oldId === newId) return;
  const d = drafts.get(oldId);
  if (d) {
    drafts.delete(oldId);
    drafts.set(newId, { ...d, id: newId });
    try {
      if (process.env.NEXT_PUBLIC_STREAM_DEBUG === 'true' || process.env.NEXT_PUBLIC_RESPONSES_DEBUG === 'true') {
        // eslint-disable-next-line no-console
        console.debug('[STREAM][Draft] renameDraft', { from: oldId, to: newId });
      }
    } catch {}
  }
}
