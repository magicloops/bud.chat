# Sidebar Menu Trigger Hover Fix

## Summary
- keep conversation rows fully hoverable for highlighting while preventing the action menu trigger from initiating navigation
- restructure each conversation item so the `<Link>` wraps only the avatar/title area and the dropdown trigger sits alongside it
- use `lucide-react`'s `MoreVertical` icon for the trigger and ensure the button hides again when focus/hover leave the row

## Testing
- n/a (UI-only change)

