# MCP Tool Calling Regression — Investigation Notes

## Summary
- Symptom: When using Anthropic (and OpenAI Chat Completions like `gpt-4o`) with MCP tools, the backend stops after emitting a tool_call and never performs the follow‑up LLM request. The SSE stream closes early, and the frontend keeps showing a loading indicator for the tool call.
- Root cause: In `app/api/chat/route.ts`, the provider stream `done` handler unconditionally emits `done`, closes the SSE controller, and `return`s, even when a tool call was produced. This prevents the outer loop from executing MCP tools and re‑invoking the model with the tool results.

## Repro Evidence (from provided logs)
```
🔧 [AnthropicProvider] Tool use started: { id: 'toolu_...', name: 'read_wiki_contents' }
🔧 [AnthropicProvider] Tool call completed: { id: 'toolu_...', name: 'read_wiki_contents', args: {...} }
🔚 [Chat API] Processing done event from provider
🔚 [Chat API] Saving events for existing conversation...
🔚 [Chat API] Existing conversation events saved in 73 ms
🔚 [Chat API] Sent complete event to frontend
🔚 [Chat API] Closed connection, frontend should be unblocked
🔚 [Chat API] Done event processed, exiting stream processing
```
- The provider produced a tool_call. Immediately after, Chat API processed `done`, sent `complete`, and closed the connection — no MCP tool execution occurred and no second LLM call was made.

## Code Path Analysis
- File: `app/api/chat/route.ts`
- High‑level structure (outer loop handles multi‑turn tool flows):
  1) While loop iterates up to `maxIterations`.
  2) If `eventLog.getUnresolvedToolCalls()` > 0 → execute MCP tools, emit `tool_result`/`tool_complete`, save, then `continue` to next iteration.
  3) Otherwise → build `chatRequest` and `for await` provider.stream(chatRequest).
  4) On provider `done` → persist, emit `message_final`, emit `done`, close SSE, and `return`.

- Relevant snippet (done handler):
```ts
case 'done':
  // persist events ...
  if (currentEvent) send({ type: 'message_final', event: currentEvent });
  sendSSE(streamingFormat.formatSSE(streamingFormat.done()));
  controller.close();
  isClosed = true;
  // For Responses API, tool calls are handled internally by OpenAI
  if (provider.name === 'openai-responses' || !hasToolCalls) {
    iteration = maxIterations;
  }
  return; // Exit the stream processing entirely
```

- Problem: The unconditional `return` ends the entire streaming response regardless of `hasToolCalls`. The intended behavior (based on the rest of the loop) is to:
  - If a tool_call occurred (`hasToolCalls === true`) and provider is NOT `openai-responses`, do NOT close SSE or return yet.
  - Instead, break out of the provider stream loop, let the outer while loop run, execute pending MCP tool calls, emit tool_result(s), save, and then re‑invoke the provider with the updated `eventLog`.

- Consequence:
  - Pending tool calls never execute (the branch that emits `tool_result`/`tool_complete` is never reached again).
  - The frontend never receives `tool_result` or the follow‑up assistant message — it keeps showing a loading state.

## Providers Affected
- Anthropic provider (`lib/providers/unified/AnthropicProvider.ts`): emits tool_call segments and then a `done` event. Chat route closes SSE on that `done`, before executing tools.
- OpenAI Chat Completions (`lib/providers/unified/OpenAIChatProvider.ts`): similar flow — tool_call segments + `done` → chat route closes SSE early.
- OpenAI Responses provider is explicitly exempted (built‑in tool use handled internally), so the early close is correct for `openai-responses` only.

## Why This Likely Regressed
- Recent integration of OpenAI Responses API added special‑case handling in the `done` section. The new logic set `iteration = maxIterations` when `provider.name === 'openai-responses' || !hasToolCalls`, but then an unconditional `return` was added afterward, which bypasses the outer loop for non‑Responses models with tool calls.

## Fix Approach (not applied yet)
- In `app/api/chat/route.ts` `case 'done':`
  - Only emit `done` and close SSE when:
    - Provider is `openai-responses`, or
    - There are no tool calls and no pending unresolved tool calls in the `eventLog`.
  - If `hasToolCalls` is true (and provider is not `openai-responses`):
    - Persist the event and emit `message_final` (optional/OK),
    - Do NOT send `done` or close the stream,
    - Break out of the provider stream loop (not `return`),
    - Allow the outer while loop to execute MCP tools, emit `tool_result`/`tool_complete`, save, and then re‑invoke the model.

This restores the multi‑turn tool execution loop for Anthropic and OpenAI Chat while keeping correct behavior for the Responses API.

## Next Steps
1) Adjust the `done` handler per above to avoid the unconditional `return` and premature close.
2) Test flows:
   - Anthropic + MCP tool → expect tool_result + re‑query + final assistant text before SSE `done`.
   - OpenAI `gpt-4o` + MCP tool → same expectations.
   - OpenAI `o*` (Responses API) → ensure existing built‑in tool behavior remains unchanged.

