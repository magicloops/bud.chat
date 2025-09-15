bud.chat

Branch-first LLM chat for the web with a unified, provider‑agnostic event model, streaming‑first UX, and Supabase persistence. The app is now modularized into internal packages for events, models, providers, streaming, and data access.

**Key ideas**
- Branching conversations from any point using unified events
- Streaming‑first: server emits SSE; client incrementally assembles/render events
- Provider‑agnostic core; OpenAI and Anthropic adapters behind a single interface
- Supabase for auth and storage of conversations and events

**Design docs**
- Modularization plan: `design/modularization-plan.md`

Packages
- `@budchat/events` — Canonical Event/Segment types, EventLog, conversions, SSE envelope. See `packages/events/README.md`.
- `@budchat/models` — Friendly→API model mapping, provider detection, capability helpers. See `packages/models/README.md`.
- `@budchat/providers` — Unified provider layer (OpenAI Chat/Responses, Anthropic) with streaming. See `packages/providers/README.md`.
- `@budchat/streaming` — EventBuilder, rendering helpers, SSE processing (server/client). See `packages/streaming/README.md`.
- `@budchat/data` — Supabase repositories for conversations and events. See `packages/data/README.md`.

Monorepo layout
```
app/                    # Next.js app router (UI + API routes)
packages/
  events/               # @budchat/events
  models/               # @budchat/models
  providers/            # @budchat/providers
  streaming/            # @budchat/streaming
  data/                 # @budchat/data
design/                 # Architecture and refactor notes
```

Getting started
- Use pnpm: `pnpm install`
- Env: copy `.env.example` to `.env.local` and fill provider keys
- Run dev server: `pnpm run dev`

Notes
- Always use pnpm for scripts and installs.
- Model selection and provider routing are centralized in `@budchat/models`.
- The app code depends on the internal packages above; each package’s README documents its surface area.

License
MIT © bud.chat contributors

