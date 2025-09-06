"use client";

import { EphemeralOverlay } from '@/components/EventList/EphemeralOverlay';

type StepsOverlayProps = {
  eventId: string;
  segments: Array<{ type: string }>;
  isStreaming?: boolean;
};

// Thin wrapper that renders the live EphemeralOverlay during streaming.
// Post-stream step display is handled by StepsDropdown.
export default function StepsOverlay({ eventId, isStreaming }: StepsOverlayProps) {
  if (!isStreaming) return null;
  return <EphemeralOverlay eventId={eventId} />;
}
