-- ============================================================
-- Migration 183 — In-app Chat
-- Apply via Supabase SQL Editor (never auto-run).
-- Creates:
--   chat_conversations  — 1-to-1 and group conversations
--   chat_participants   — members in each conversation
--   chat_messages       — individual messages
-- Plus:
--   Trigger to bump updated_at on new message
--   RPC get_my_conversations(p_member_id)
--   RPC find_direct_conversation(p_member_id_1, p_member_id_2)
--   RLS policies on all three tables
--   Realtime enabled on chat_messages
-- ============================================================

-- ── Tables ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_conversations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text,                                                 -- NULL for 1-to-1; required for group
  is_group    boolean     NOT NULL DEFAULT false,
  created_by  uuid        REFERENCES members(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_participants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  member_id       uuid        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, member_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id       uuid        REFERENCES members(id) ON DELETE SET NULL,
  sender_name     text        NOT NULL,
  sender_email    text        NOT NULL,
  content         text        NOT NULL
                              CHECK (char_length(content) > 0 AND char_length(content) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Indices ─────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS chat_participants_conv_idx   ON chat_participants(conversation_id);
CREATE INDEX IF NOT EXISTS chat_participants_member_idx ON chat_participants(member_id);
CREATE INDEX IF NOT EXISTS chat_messages_conv_idx       ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS chat_messages_created_idx    ON chat_messages(created_at DESC);

-- ── Trigger: bump updated_at on new message ──────────────────────

CREATE OR REPLACE FUNCTION chat_bump_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE chat_conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_messages_bump ON chat_messages;
CREATE TRIGGER trg_chat_messages_bump
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_bump_updated_at();

-- ── RPC: get_my_conversations ────────────────────────────────────
-- Returns all conversations the given member is part of,
-- including last message preview, unread count, and participant list.

CREATE OR REPLACE FUNCTION get_my_conversations(p_member_id uuid)
RETURNS TABLE (
  conversation_id      uuid,
  name                 text,
  is_group             boolean,
  updated_at           timestamptz,
  last_message         text,
  last_message_at      timestamptz,
  last_message_sender  text,
  unread_count         bigint,
  participants         jsonb   -- other participants (not the caller)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id                          AS conversation_id,
    c.name,
    c.is_group,
    c.updated_at,
    lm.content                    AS last_message,
    lm.created_at                 AS last_message_at,
    lm.sender_name                AS last_message_sender,
    (
      SELECT COUNT(*)::bigint
      FROM   chat_messages m2
      WHERE  m2.conversation_id = c.id
        AND  m2.created_at > cp.last_read_at
        AND  m2.sender_id IS DISTINCT FROM p_member_id
    )                             AS unread_count,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'member_id', m.id,
        'name',      COALESCE(
                       NULLIF(TRIM(COALESCE(m.first_name,'') || ' ' || COALESCE(m.last_name,'')), ''),
                       m.name,
                       m.email
                     ),
        'email',     m.email
      ) ORDER BY COALESCE(
                   NULLIF(TRIM(COALESCE(m.first_name,'') || ' ' || COALESCE(m.last_name,'')), ''),
                   m.name, m.email
                 ))
      FROM   chat_participants p2
      JOIN   members m ON m.id = p2.member_id
      WHERE  p2.conversation_id = c.id
        AND  p2.member_id != p_member_id
    )                             AS participants
  FROM  chat_conversations c
  JOIN  chat_participants   cp ON cp.conversation_id = c.id AND cp.member_id = p_member_id
  LEFT JOIN LATERAL (
    SELECT content, created_at, sender_name
    FROM   chat_messages
    WHERE  conversation_id = c.id
    ORDER  BY created_at DESC
    LIMIT  1
  ) lm ON true
  ORDER BY c.updated_at DESC;
END;
$$;

-- ── RPC: find_direct_conversation ───────────────────────────────
-- Returns the id of an existing 1-to-1 conversation between two
-- members, or NULL if none exists.

CREATE OR REPLACE FUNCTION find_direct_conversation(
  p_member_id_1 uuid,
  p_member_id_2 uuid
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM   chat_conversations c
  WHERE  c.is_group = false
    AND  (SELECT COUNT(*) FROM chat_participants WHERE conversation_id = c.id) = 2
    AND  EXISTS (SELECT 1 FROM chat_participants WHERE conversation_id = c.id AND member_id = p_member_id_1)
    AND  EXISTS (SELECT 1 FROM chat_participants WHERE conversation_id = c.id AND member_id = p_member_id_2)
  LIMIT 1;
$$;

-- ── RLS helper ──────────────────────────────────────────────────
-- Returns true if the currently authenticated user is a participant
-- in the given conversation.

CREATE OR REPLACE FUNCTION is_chat_participant(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   chat_participants cp
    JOIN   members m ON m.id = cp.member_id
    WHERE  cp.conversation_id = p_conversation_id
      AND  m.email = auth.email()
  );
$$;

-- ── Enable RLS ──────────────────────────────────────────────────

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages      ENABLE ROW LEVEL SECURITY;

-- chat_conversations policies
DROP POLICY IF EXISTS chat_conv_select ON chat_conversations;
CREATE POLICY chat_conv_select ON chat_conversations
  FOR SELECT USING (is_chat_participant(id));

DROP POLICY IF EXISTS chat_conv_insert ON chat_conversations;
CREATE POLICY chat_conv_insert ON chat_conversations
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- chat_participants policies
DROP POLICY IF EXISTS chat_part_select ON chat_participants;
CREATE POLICY chat_part_select ON chat_participants
  FOR SELECT USING (is_chat_participant(conversation_id));

DROP POLICY IF EXISTS chat_part_insert ON chat_participants;
CREATE POLICY chat_part_insert ON chat_participants
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS chat_part_update ON chat_participants;
CREATE POLICY chat_part_update ON chat_participants
  FOR UPDATE USING (
    member_id = (SELECT id FROM members WHERE email = auth.email() LIMIT 1)
  );

-- chat_messages policies
DROP POLICY IF EXISTS chat_msg_select ON chat_messages;
CREATE POLICY chat_msg_select ON chat_messages
  FOR SELECT USING (is_chat_participant(conversation_id));

DROP POLICY IF EXISTS chat_msg_insert ON chat_messages;
CREATE POLICY chat_msg_insert ON chat_messages
  FOR INSERT WITH CHECK (
    is_chat_participant(conversation_id)
    AND sender_email = auth.email()
  );

-- ── Realtime ────────────────────────────────────────────────────
-- Enable realtime broadcast for chat_messages so the ChatPanel
-- receives new messages instantly without polling.
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
