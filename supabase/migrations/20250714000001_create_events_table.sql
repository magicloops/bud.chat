-- Create events table for vendor-agnostic message schema
-- This migration creates the new events table alongside the existing messages table

-- Create events table
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  segments jsonb NOT NULL DEFAULT '[]',
  ts bigint NOT NULL,
  order_key text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_events_conversation_id ON public.events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON public.events(ts);
CREATE INDEX IF NOT EXISTS idx_events_order_key ON public.events(order_key);
CREATE INDEX IF NOT EXISTS idx_events_role ON public.events(role);

-- GIN index for efficient segment queries
CREATE INDEX IF NOT EXISTS idx_events_segments ON public.events USING gin (segments);

-- Create composite index for conversation queries
CREATE INDEX IF NOT EXISTS idx_events_conversation_order ON public.events(conversation_id, order_key);

-- Enable RLS on events table
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- RLS policies for events table
-- Users can only access events in conversations they have access to
CREATE POLICY "Users can view events in their conversations"
  ON public.events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = events.conversation_id
      AND (
        -- Personal workspace (user owns the conversation)
        c.workspace_id IN (
          SELECT id FROM public.workspaces
          WHERE owner_user_id = auth.uid()
        )
        OR
        -- Shared workspace (user is a member)
        c.workspace_id IN (
          SELECT workspace_id FROM public.workspace_members
          WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Users can insert events in their conversations"
  ON public.events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = events.conversation_id
      AND (
        -- Personal workspace (user owns the conversation)
        c.workspace_id IN (
          SELECT id FROM public.workspaces
          WHERE owner_user_id = auth.uid()
        )
        OR
        -- Shared workspace (user is a member)
        c.workspace_id IN (
          SELECT workspace_id FROM public.workspace_members
          WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Users can update events in their conversations"
  ON public.events FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = events.conversation_id
      AND (
        -- Personal workspace (user owns the conversation)
        c.workspace_id IN (
          SELECT id FROM public.workspaces
          WHERE owner_user_id = auth.uid()
        )
        OR
        -- Shared workspace (user is a member)
        c.workspace_id IN (
          SELECT workspace_id FROM public.workspace_members
          WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Users can delete events in their conversations"
  ON public.events FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = events.conversation_id
      AND (
        -- Personal workspace (user owns the conversation)
        c.workspace_id IN (
          SELECT id FROM public.workspaces
          WHERE owner_user_id = auth.uid()
        )
        OR
        -- Shared workspace (user is a member)
        c.workspace_id IN (
          SELECT workspace_id FROM public.workspace_members
          WHERE user_id = auth.uid()
        )
      )
    )
  );

-- Add trigger to update updated_at timestamp (if we decide to add this column later)
-- CREATE OR REPLACE FUNCTION public.update_updated_at_column()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   NEW.updated_at = now();
--   RETURN NEW;
-- END;
-- $$ language 'plpgsql';

-- CREATE TRIGGER update_events_updated_at
--   BEFORE UPDATE ON public.events
--   FOR EACH ROW
--   EXECUTE FUNCTION public.update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE public.events IS 'Event-based message storage for vendor-agnostic chat system';
COMMENT ON COLUMN public.events.id IS 'Unique identifier for the event';
COMMENT ON COLUMN public.events.conversation_id IS 'Reference to the conversation this event belongs to';
COMMENT ON COLUMN public.events.role IS 'Role of the event: system, user, assistant, or tool';
COMMENT ON COLUMN public.events.segments IS 'JSON array of segments: text, tool_call, or tool_result';
COMMENT ON COLUMN public.events.ts IS 'Unix timestamp in milliseconds when the event occurred';
COMMENT ON COLUMN public.events.order_key IS 'Fractional indexing key for ordering events within a conversation';
COMMENT ON COLUMN public.events.created_at IS 'Timestamp when the event was created in the database';