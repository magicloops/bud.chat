// Client-facing exports that avoid re-exporting FrontendEventHandler to prevent cycles
export { EventBuilder } from './eventBuilder';
export * from './rendering';
export * from './eventBuilderRegistry';
export * from './ephemeralOverlayRegistry';
export { sseIterator, processSSE, type StreamHandlers } from './streamProcessor';

