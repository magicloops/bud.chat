# Conversation Avatar Rendering & Sidebar Menu Polish

## Summary
- render the correct user avatars in conversation events (reading Supabase metadata inside `EventItemSequential`)
- persist assistant name/avatar on conversation summaries so the sidebar can display the matching assistant identity
- surface the signed-in user’s avatar/name in the sidebar user menu via `useAuth`
- while wiring avatars, fix the sidebar menu trigger so the dropdown sits outside the navigation link, appears only on hover/focus, and uses the `MoreVertical` icon

## Testing
- n/a (UI-only change)
