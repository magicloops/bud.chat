# Export Modal Overflow – Layout Notes

## Component hierarchy
- `EventJsonMode` renders the **Export Code** button. When opened it mounts `DialogContent` (default Tailwind: `grid w-full max-w-lg …`). We override the width via `className="max-w-3xl"`.
- Inside `DialogContent` we render a Radix `Tabs` root:
  - `TabsList` (from `components/ui/tabs.tsx`) – inherits `inline-flex h-10 …` and we add `flex-wrap` in `EventJsonMode`. Because it is `inline-flex`, its intrinsic width tracks the widest trigger label.
  - `TabsContent` – Radix content wrapper (`display: block; width: auto`) with our container `div.mt-3.max-h-[420px].overflow-y-auto.pr-1.space-y-4` wrapping each `TabsContent`.
  - Each panel hosts a single wrapper `div.w-full.overflow-x-auto.rounded-md.border.bg-muted/20` containing the `CodeBlock`.
- `CodeBlock` (`components/CodeBlock.tsx`) renders a header + `react-syntax-highlighter` (`<pre><code>`). We already set `wrapLongLines` and force `width: 100%`, `overflowX: 'auto'`.

## Observations
- Long URL-like tokens are rendered inside a single `<span>` with no whitespace, so `pre-wrap` cannot wrap them; the `<pre>` then expands wider than the modal. Although the outer wrapper has `overflow-x-auto`, Radix Tabs measures the child panel’s scroll width which stretches the modal beyond its intended `max-w-3xl`.
- The issue is *not* the TabList width alone—the overflow text expands `TabsContent`, which forces `DialogContent` to grow. Because the modal content is `display: grid` with `w-full`, the intrinsic width of the `TabsContent` determines the modal width.

## Fix directions
- Clamp the panel to the modal width by adding `max-w-full` + `overflow-hidden` at the panel level (e.g. on the `div.mt-3…` wrapper and/or `TabsContent`), ensuring it never reports a width larger than the dialog.
- Additionally, enable token-level wrapping for unbroken strings inside the code block: setting `word-break: break-word` or `overflow-wrap: anywhere` on the `<code>` element (via `codeTagProps.style`) will allow long URLs to wrap without horizontal spillover.
- Optional: convert `TabsList` to `flex` with `w-full overflow-x-auto` so trigger labels remain visible on smaller widths without stretching the root.

No extra component docs needed—the Radix Tabs and our `CodeBlock` implementation already describe the relevant styles.
