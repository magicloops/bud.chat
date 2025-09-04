import { Event } from '@/state/eventChatStore';

export type EphemeralKind = 'idle' | 'reasoning' | 'tool' | 'built_in' | 'writing';

export interface EphemeralOverlayState {
  eventId: string;
  kind: EphemeralKind;
  reasoning?: { text: string; item_id?: string; currentPartIndex?: number; updatedAt: number };
  tool?: { id: string; name?: string; status?: string; updatedAt: number };
  writing?: { updatedAt: number };
  builtIn?: { message?: string; updatedAt: number };
  // Sticky flag indicating a non-idle overlay was shown at least once for this event
  seenNonIdle?: boolean;
}

type Listener = (state: EphemeralOverlayState | null) => void;

const overlays = new Map<string, EphemeralOverlayState>();
const overlayFlags = new Map<string, { seenNonIdle: boolean }>();
const listeners = new Map<string, Set<Listener>>();

export function setOverlay(eventId: string, state: EphemeralOverlayState | null) {
  if (state === null) {
    // Clear current overlay but retain flags/history
    overlays.delete(eventId);
  } else {
    // Update sticky flags
    if (state.kind !== 'idle') {
      const prev = overlayFlags.get(eventId) || { seenNonIdle: false };
      prev.seenNonIdle = true;
      overlayFlags.set(eventId, prev);
      state.seenNonIdle = true;
    } else {
      // Preserve seenNonIdle if previously set
      const prev = overlayFlags.get(eventId);
      if (prev?.seenNonIdle) state.seenNonIdle = true;
    }
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
  const cur = overlays.get(eventId) || null;
  if (!cur) return null;
  const flags = overlayFlags.get(eventId);
  return flags?.seenNonIdle ? { ...cur, seenNonIdle: true } : cur;
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
export function hasSeenNonIdle(eventId: string): boolean {
  const f = overlayFlags.get(eventId);
  return !!(f && f.seenNonIdle);
}
