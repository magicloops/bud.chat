# Chat Input Autofocus, Global Typing Capture, and Streaming Compose UX

## Summary
- Autofocus the chat input on open (new and existing chats).
- Capture initial typing when no other input is focused, focusing the composer and appending the first keystrokes (including the triggering key).
- Keep the input editable during assistant streaming; disable only the Send action.
- Add a subtle neon-green focus glow for the composer input to guide attention.
- Remove unused `components/EventChatInterface.tsx` to enforce a single chat input surface.
- Add a design doc outlining the approach and constraints.

## Rationale
- Faster start: Users can begin typing immediately without clicking.
- Resilient input: Keystrokes aren’t lost when the composer isn’t focused.
- Better streaming UX: Users can prepare the next message while the AI streams.
- Visual clarity: Neon focus glow clarifies where to type.

## User-Facing Changes
- Input is auto-focused on chat load.
- Typing anywhere with no inputs focused auto-focuses the composer and inserts typed characters.
- During streaming, the input remains editable; Send is disabled until streaming completes.
- Composer shows a green 1px border and soft glow on focus (light/dark).

## Implementation
- New hook `hooks/useTypeToFocus.ts`
  - Autofocus on mount when enabled.
  - Document-level keydown (capture) that:
    - Skips when another editable element is focused or when modifier keys are used.
    - Handles printable characters and Enter (newline), focuses the textarea, and appends via callback.
  - Typed as `RefObject<HTMLTextAreaElement | null>` to match React refs.

- Composer changes `components/EventComposer/index.tsx`
  - Integrates `useTypeToFocus` (append callback updates local `message`).
  - Keeps textarea editable during streaming/loading (no `disabled` on the textarea).
  - Adds focus visuals via a rounded wrapper with `focus-within` border+glow and a clean textarea (no inner ring).
  - Send button remains disabled when `!message.trim()` or `disabled || isLoading`.

- Event stream integration `components/EventStream.tsx`
  - For existing conversations, pass `disabled={isLocalStreaming || !!conversation.isStreaming}` to disable Send while streaming.

- Removed unused component
  - Deleted `components/EventChatInterface.tsx` (was not referenced anywhere).

- Design doc
  - `design/chat-input-autofocus.md` documents requirements, approach, a11y, edge cases, and test plan.

## Files Touched
- Added: `hooks/useTypeToFocus.ts`
- Modified: `components/EventComposer/index.tsx`, `components/EventStream.tsx`, `design/chat-input-autofocus.md`
- Removed: `components/EventChatInterface.tsx`

## How to Test
- New chat: Navigate to `/chat/new` (or open a new chat flow). Input should autofocus.
- Existing chat: Open any existing conversation. Input should autofocus.
- Global typing capture: Click outside inputs and start typing; composer should focus and include the characters (including the first one).
- Enter/Shift+Enter: Enter sends; Shift+Enter inserts newline.
- Streaming compose: Send a message and, while the assistant streams, verify input remains editable and Send is disabled.
- Focus visuals: Tab/click into the composer; see 1px green border and soft glow (light and dark themes).
- No double focus: If another input is focused (e.g., a settings field), global typing capture should not trigger.

## Accessibility
- Autofocus on chat load aligns with chat UI patterns; the global listener does not auto-submit.
- Modifier keys and when another input is focused are ignored to respect shortcuts and existing input focus.

## Risk/Impact
- Low risk: Changes isolated to the composer and its parent stream component. No backend changes.
- The document-level keydown listener is lightweight, guarded, and removed on unmount.

## Follow-ups (optional)
- Queueing next messages while streaming.
- IME/composition-aware handling for first keystrokes (if needed for international input edge cases).
- Preference toggle for “type to focus” behavior if requested.

