-- Add metadata column to conversation table
alter table conversation add column metadata jsonb default '{}';

-- Create index for metadata queries
create index idx_conversation_metadata on conversation using gin (metadata);