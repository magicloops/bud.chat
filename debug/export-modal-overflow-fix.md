# Export Modal Overflow – Fix Notes

## Proposed changes
1. **Clamp panel width**
   - In `EventJsonMode`, apply `max-w-full` and `overflow-hidden` to the `<TabsContent>` wrapper and its inner container to prevent intrinsic expansion beyond the modal width.
   - Example: `TabsContent` `className="space-y-3 max-w-full"` and child wrapper `className="w-full max-w-full overflow-x-auto ..."`.

2. **Enable word wrapping inside code**
   - Update `CodeBlock` to add `wordBreak: 'break-word'` (or `overflowWrap: 'anywhere'`) on both the syntax highlighter container and `code` tag so long tokens (URLs) wrap rather than stretching horizontally.

3. (Optional) Keep `TabsList` as-is; current flex-wrap is adequate once panels respect modal width.

## Implementation steps
- Modify `components/EventJsonMode/EventJsonMode.tsx`: ensure the div with `mt-3 max-h-[420px] ...` gets `max-w-full`, and `TabsContent` panels inherit `max-w-full` plus `overflow-hidden` to avoid Radix measuring expanded width.
- Adjust `components/CodeBlock.tsx`: add `wordBreak: 'break-word'`, `overflowWrap: 'anywhere'`, and remove redundant width styles to let wrapping occur without horizontal scroll.
- Verify with conversation exports containing long URLs.

## Testing
- Manual: open JSON mode, trigger export modal, select each tab, confirm code stays within modal width and long URLs wrap.
- Automated: no dedicated test; rely on visual QA.
