# Anthropic Duplicate Text Investigation

## Symptom
- Assistant events stored in the database contain back-to-back text segments with identical content (example from conversation `…` shows two identical `type: "text"` blocks before/after a tool call result).
- The JSON-mode view simply reflects what is persisted, so deduping in the UI merely hides an upstream issue.

## Observations
1. **DB Data**
   - The `events.segments` array for the affected Anthropic assistant event already holds duplicate text entries, matching the output seen in JSON mode.
   - Therefore the duplication occurs before the JSON view layer; likely during streaming/persistence.

2. **Streaming Path (`packages/providers/src/unified/AnthropicProvider.ts`)**
   - During streaming we create `currentEvent` and push segments as chunks arrive (see lines ~70-120).
   - For each `content_block_delta` of type `text_delta` we accumulate `currentText` and also emit a `segment` SSE with that delta: `yield { type: 'segment', data: { segment: { type: 'text', text: chunk.delta.text } } }`.
   - When `content_block_stop` fires we push the fully accumulated text into `currentEvent.segments`: `currentEvent.segments.push({ type: 'text', text: currentText })` and reset `currentText`.
   - Because the SSE stream drove `EventBuilder.appendTextDelta`, the client-side placeholder already contains the full text before the server’s `currentEvent` is finalized. When we persist `currentEvent` we may therefore end up with both the builder-generated text segment **and** the server-side `currentText` segment depending on how final persistence merges data.

3. **Event Builder (`packages/streaming/src/eventBuilder.ts`)**
   - `appendTextDelta` appends deltas to the existing assistant placeholder text segment (see `flushTextBuffer`), so the client’s in-memory event already holds the complete assistant text.
   - When the server sends the final assistant event (containing the aggregated text block) the frontend replaces the placeholder (see `FrontendEventHandler.onMessageFinal`). The DB persists the server-side event, so if `currentEvent.segments` already includes text, duplicates will remain.

4. **Non-stream Path**
   - The `chat` (non-stream) path converts the Anthropic SDK `response.content` array into segments (see `anthropicResponseToEvent`). If the SDK response already contains duplicate text blocks we would persist them verbatim. Need to confirm via raw API event dumps whether duplicates originate from Anthropic or our handling.

## Hypotheses
- **Double append during streaming persistence:** The server inserts the aggregated text into `currentEvent.segments`, while the placeholder->final merge also retains the text accumulated via deltas, leading to duplicate entries when the final event is stored.
- **Anthropic response delivering duplicated content blocks:** Raw streaming events may include identical `content_block` payloads (e.g., a text block delivered twice). Our handler currently trusts the provider output and pushes every block into the final event.

## Next Steps
1. **Streaming Logs** *(done conceptually)*
   - The code path showed `AnthropicProvider` adding the aggregated `currentText` block to `currentEvent.segments` during `content_block_stop`, after deltas had already been appended via SSE/`EventBuilder`.

2. **Fix Implemented**
   - Removed the aggregated text push inside `content_block_stop` while leaving delta emission in place (`packages/providers/src/unified/AnthropicProvider.ts`).
   - Removed the temporary JSON-mode dedupe utility to verify data cleanliness.

3. **Verification**
   - Existing Jest suites (`pnpm test:events`, `pnpm test:exports`) still pass.
   - JSON-mode output now reflects a single text entry for Anthropic assistant turns, matching the DB payload post-fix.

4. **Future Work**
   - Consider regression tests that simulate Anthropic streaming to guard against reintroducing aggregated text blocks.
