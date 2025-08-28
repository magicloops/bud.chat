# Chat Input Autofocus & Global Typing Capture

## Overview
- Goal: Make starting/continuing chats faster by auto-focusing the input on open and capturing user typing when no other input has focus. Allow composing while the assistant streams (disable only the send action, not the input field).
- Scope: Frontend only. Minimal, localized changes to composer components. No backend changes.

## Current Frontend Flow
- New conversations: `app/(chat)/chat/[conversationId]/page.tsx` renders `components/EventStream.tsx` with `events` and `onSendMessage`.
- Existing conversations: Same page renders `EventStream` with `conversationId` and store-driven state.
- Composer: `EventStream` always renders `components/EventComposer/index.tsx` (for both new and existing conversations). This is the canonical input/send component.
- Streaming: While streaming, `EventComposer` currently disables the `Textarea` (via `disabled` prop) and the Send button.

## Requirements
1. Autofocus the chat input when a chat page opens (new or existing).
2. If no input is focused and the user starts typing, focus the chat input and include the triggering keystroke without losing it.
3. Allow composing during assistant streaming: do not disable the text input; only disable sending.

## Design Summary
- Introduce a small hook `useTypeToFocus(ref, enabled)` to:
  - Autofocus the referenced textarea on mount (and on chat change).
  - Add a `keydown` listener at the document level to capture printable keystrokes when no text input/textarea/contenteditable is focused, then focus the textarea and insert the character/newline.
  - Ignore modified keys (Ctrl/Cmd/Alt), navigation keys, and when any input is already focused.
- Apply this hook in `components/EventComposer/index.tsx` (composer used by `EventStream`).
- Remove the `disabled` attribute from the textareas; keep disabling only the send button when `isStreaming` or a local `isLoading` state is true.

## Detailed Behavior
- Autofocus
  - On mount and when the conversation context changes, call `ref.current?.focus()` inside `useEffect` with a microtask `setTimeout(…, 0)` fallback to ensure DOM readiness.
  - Also set `autoFocus` on the `Textarea` (harmless redundancy; React manages hydration safely here).

- Global Typing Capture
  - Listener: `document.addEventListener('keydown', onKeyDown, { capture: true })`.
  - Guardrails:
    - Skip if `document.activeElement` is an `INPUT`, `TEXTAREA`, or an element with `contentEditable="true"`.
    - Skip if `e.metaKey || e.ctrlKey || e.altKey`.
  - Keys handled:
    - Printable characters (`e.key.length === 1`) including space.
    - Optionally handle `Enter` by inserting a newline. Do not trigger send from the global listener.
  - Actions:
    - `e.preventDefault()` to avoid page scroll/shortcuts.
    - Focus the textarea ref.
    - Append the character/newline to the current value and set caret at the end (sufficient when focusing from no selection state).
  - Cleanup: remove the listener on unmount.

- Send-Only Disable
  - `EventComposer`: Remove `disabled={…}` from `Textarea`; retain `disabled` logic on the Send button: `disabled={!message.trim() || isLoading || isStreaming}` (the existing component already has `isLoading`; `isStreaming` is known for new conv via prop; for existing conv, rely on local loading and the store’s streaming state as needed; behavior remains consistent if we keep the button disable conditions as-is where available).

## Components To Touch (Minimal Changes)
- `components/EventComposer/index.tsx`
  - Add `useTypeToFocus` with a `textareaRef`.
  - Remove `disabled={disabled || isLoading}` from `Textarea`.
  - Keep Send button disabled conditions unchanged.


- New hook: `hooks/useTypeToFocus.ts`
  - Encapsulates the autofocus + global keydown behavior.

## Accessibility & UX Notes
- Screen readers: Focusing the textarea on open is common for chat UIs. We do not auto-submit on Enter via the global listener; actual sending remains an explicit action.
- Keyboard shortcuts: Ignored when modifier keys are used. We only capture printable keys and optionally Enter (newline) when no input has focus.
- Mobile: On mobile browsers, global keydown handling may vary; autofocus will bring up the keyboard in many cases. The listener is a no-op if virtual keyboards do not emit keydown prior to focus.

## Edge Cases
- IME/composition: We do not handle composition events; initial typed character will append literally. Acceptable for first iteration.
- Multiple composers: Only one composer should be present on a chat page. If multiple exist, the first enabled instance using the hook will capture input; acceptable given current layout.
- Route transitions: On chat switch, `useEffect` in consumer can refocus automatically (same hook can accept a dependency token to re-run focus on conversation change if needed).

## Testing Plan
- Open new chat and existing chat pages: confirm textarea is focused on load.
- With no input focused, type a letter: textarea focuses and letter appears.
- Type rapidly as first input: initial characters are not lost.
- While streaming: ensure textarea remains editable; Send is disabled; Stop works as before.
- With another input (e.g., settings search) focused: global typing capture should NOT trigger.

## Rollout Steps
1. Implement `useTypeToFocus` hook in `hooks/`.
2. Wire hook into `EventComposer`.
3. Remove `disabled` from the textarea; keep Send disabling as-is.
4. Manual test across new/existing chats and during streaming.

## Notes on Minimality
- No changes to state stores, streaming handlers, or backend.
- Localized to a single component and one small, reusable hook.
