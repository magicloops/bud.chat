import { Event } from '@/state/eventChatStore';

export type EphemeralKind = 'idle' | 'reasoning' | 'tool' | 'built_in' | 'writing';

export interface EphemeralOverlayState {
  eventId: string;
  kind: EphemeralKind;
  reasoning?: { text: string; item_id?: string; currentPartIndex?: number; updatedAt: number };
  tool?: { id: string; name?: string; status?: string; updatedAt: number };
  writing?: { updatedAt: number };
  builtIn?: { message?: string; updatedAt: number };
}

type Listener = (state: EphemeralOverlayState | null) => void;

const overlays = new Map<string, EphemeralOverlayState>();
const listeners = new Map<string, Set<Listener>>();

export function setOverlay(eventId: string, state: EphemeralOverlayState | null) {
  if (state === null) {
    overlays.delete(eventId);
  } else {
    overlays.set(eventId, state);
  }
  const ls = listeners.get(eventId);
  if (ls) {
    for (const cb of ls) {
      try { cb(state); } catch {}
    }
  }
}

export function getOverlay(eventId: string): EphemeralOverlayState | null {
  return overlays.get(eventId) || null;
}

export function subscribeOverlay(eventId: string, cb: Listener): () => void {
  let ls = listeners.get(eventId);
  if (!ls) {
    ls = new Set();
    listeners.set(eventId, ls);
  }
  ls.add(cb);
  // push current
  try { cb(getOverlay(eventId)); } catch {}
  return () => {
    const cur = listeners.get(eventId);
    if (cur) {
      cur.delete(cb);
      if (cur.size === 0) listeners.delete(eventId);
    }
  };
}

// Sticky query helper for renderers that need to know if a non-idle overlay ever occurred
// no additional helpers
