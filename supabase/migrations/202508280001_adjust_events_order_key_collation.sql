-- Adjust events.order_key collation to ASCII (C) and enforce uniqueness
-- This ensures fractional-indexing keys sort correctly and remain unique per conversation

-- 1) Drop dependent indexes (will recreate after altering collation)
DROP INDEX IF EXISTS idx_events_order_key;
DROP INDEX IF EXISTS idx_events_conversation_order;

-- 2) Alter column collation to C (bytewise/ASCII)
ALTER TABLE public.events
  ALTER COLUMN order_key TYPE text COLLATE "C";

-- 3) Recreate indexes using the new collation
CREATE INDEX IF NOT EXISTS idx_events_order_key ON public.events(order_key);
CREATE INDEX IF NOT EXISTS idx_events_conversation_order ON public.events(conversation_id, order_key);

-- 3.5) De-duplicate existing (conversation_id, order_key) pairs by appending '0's
DO $$
DECLARE
  rec RECORD;
  dup RECORD;
  suffix text;
  try_key text;
BEGIN
  FOR rec IN
    SELECT conversation_id, order_key, COUNT(*) AS cnt
    FROM public.events
    GROUP BY conversation_id, order_key
    HAVING COUNT(*) > 1
  LOOP
    -- Keep the earliest row as-is; adjust the rest deterministically
    FOR dup IN
      SELECT id
      FROM public.events
      WHERE conversation_id = rec.conversation_id
        AND order_key = rec.order_key
      ORDER BY created_at, id
      OFFSET 1
    LOOP
      suffix := '0';
      try_key := rec.order_key || suffix;
      -- Find a unique key by appending additional '0's if necessary
      WHILE EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.conversation_id = rec.conversation_id
          AND e.order_key = try_key
      ) LOOP
        suffix := suffix || '0';
        try_key := rec.order_key || suffix;
      END LOOP;

      UPDATE public.events
        SET order_key = try_key
        WHERE id = dup.id;
    END LOOP;
  END LOOP;
END$$;

-- 4) Enforce uniqueness per conversation
ALTER TABLE public.events
  ADD CONSTRAINT events_conversation_order_key_unique UNIQUE (conversation_id, order_key);
