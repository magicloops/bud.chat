@budchat/events

Core, provider‑agnostic event model used across Bud Chat. This package defines the unified Event/Segment types, branded IDs, progress helpers, conversion utilities to/from provider message formats, and a simple streaming envelope for SSE.

## What it does
- Canonical types: `Event`, `Segment`, `ReasoningPart`, `ResponseMetadata`, roles.
- Branded IDs and generators: `ConversationId`, `EventId`, `ToolCallId`, `generate*()`.
- EventLog utilities:
  - `getEvents()`, `addEvent()`, `updateEvent()`.
  - `getUnresolvedToolCalls()` to drive tool execution loops.
  - `toProviderMessages('openai' | 'anthropic')` and `getSystemMessage()`.
- Converters: `EventConverter` for translating between provider message objects and unified events.
- Streaming envelope: `StreamingFormat` for serializing standardized SSE events (`event_start`, `segment`, `event_complete`, `error`, `complete`).
- Helpers: `createTextEvent`, `createToolCallEvent`, `createToolResultEvent`, `createReasoningSegment`, `sortSegmentsBySequence`.

## How it connects
Other packages depend on these types and helpers:
- `@budchat/providers` converts unified events to provider requests and assembles streamed segments back into events.
- `@budchat/streaming` renders segments and processes SSE using the same event types.
- `@budchat/data` persists and hydrates events using these type shapes.

## Usage
```ts
import { EventLog, createTextEvent, StreamingFormat } from '@budchat/events'

const log = new EventLog([
  createTextEvent('system', 'You are Bud.'),
  createTextEvent('user', 'Hello!'),
])

// Convert to provider format
const openaiMessages = log.toProviderMessages('openai')

// Stream envelope for SSE
const fmt = new StreamingFormat()
const sseChunk = fmt.formatSSE(fmt.eventStart(createTextEvent('assistant', '')))
```

## Notes
- The OpenAI mapping uses Chat Completions conventions; Anthropic mapping uses `tool_use/tool_result` blocks and system message parameter.
- Tool results can be emitted inline (as a `tool_result` segment) or in a separate tool role event; renderers and providers normalize both.

