-- =============================================================================
-- VNStation Milestone 7 — Supabase PostgreSQL Schema & Row-Level Security (RLS)
-- =============================================================================
-- Provides:
-- 1. Cryptographically random, non-sequential Friend Code generator (VNS-XXXX-XXXX)
-- 2. Profiles, Friendships, Blocks, Conversations, Participants, Messages, Reports
-- 3. Strict Row-Level Security (RLS) policies on every table and Realtime publication
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Secure Friend Code Generator (unambiguous alphabet: 23456789ABCDEFGHJKLMNPQRSTUVWXYZ)
CREATE OR REPLACE FUNCTION public.generate_unique_friend_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  alphabet CONSTANT TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  bytes BYTEA;
  candidate TEXT;
  i INT;
BEGIN
  LOOP
    bytes := gen_random_bytes(8);
    candidate := 'VNS-';
    FOR i IN 0..7 LOOP
      IF i = 4 THEN
        candidate := candidate || '-';
      END IF;
      candidate := candidate || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE friend_code = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
END;
$$;

-- 2. Profiles Table (Primary identity = Supabase auth.users.id)
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id             UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username            TEXT NOT NULL CHECK (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  display_name        TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 48),
  friend_code         TEXT NOT NULL UNIQUE DEFAULT public.generate_unique_friend_code()
                      CHECK (friend_code ~ '^VNS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$'),
  bio                 TEXT NOT NULL DEFAULT '' CHECK (char_length(bio) <= 600),
  avatar_preset       TEXT NOT NULL DEFAULT 'aoko'
                      CHECK (avatar_preset IN ('aoko', 'stella', 'kurisu', 'sakura', 'nocturne', 'ember')),
  avatar_url          TEXT,
  presence            TEXT NOT NULL DEFAULT 'online' CHECK (presence IN ('online', 'away', 'offline')),
  currently_playing   TEXT CHECK (currently_playing IS NULL OR char_length(currently_playing) <= 120),
  customization       JSONB NOT NULL DEFAULT '{}'::jsonb,
  privacy             JSONB NOT NULL DEFAULT '{"profileVisibility":"friends","showOnlineStatus":true,"showCurrentlyPlaying":true,"showFriendsList":true,"featuredVnsVisibility":"friends","allowFriendRequestsByCode":true}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower ON public.profiles (lower(username));
CREATE INDEX IF NOT EXISTS idx_profiles_friend_code ON public.profiles (friend_code);

-- 3. User Blocks Table
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id  UUID NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON public.user_blocks (blocked_id);

-- Helper: true if either user has blocked the other
CREATE OR REPLACE FUNCTION public.is_blocked_between(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_blocks
    WHERE (blocker_id = user_a AND blocked_id = user_b)
       OR (blocker_id = user_b AND blocked_id = user_a)
  );
$$;

-- 4. Friendships Table (State machine with canonical pair uniqueness)
CREATE TABLE IF NOT EXISTS public.friendships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  recipient_id  UUID NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  pair_low      UUID GENERATED ALWAYS AS (LEAST(requester_id, recipient_id)) STORED,
  pair_high     UUID GENERATED ALWAYS AS (GREATEST(requester_id, recipient_id)) STORED,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at   TIMESTAMPTZ,
  CHECK (requester_id <> recipient_id),
  UNIQUE (pair_low, pair_high)
);

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_recipient ON public.friendships (recipient_id, status);

-- Helper: true if user_a and user_b have an active accepted friendship and neither is blocked
CREATE OR REPLACE FUNCTION public.are_accepted_friends(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.friendships f
    WHERE f.pair_low = LEAST(user_a, user_b)
      AND f.pair_high = GREATEST(user_a, user_b)
      AND f.status = 'accepted'
  ) AND NOT public.is_blocked_between(user_a, user_b);
$$;

-- 5. Conversations & Participants (Direct 1-to-1 Messaging)
CREATE TABLE IF NOT EXISTS public.conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL DEFAULT 'direct' CHECK (type = 'direct'),
  pair_low    UUID NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  pair_high   UUID NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (pair_low < pair_high),
  UNIQUE (pair_low, pair_high)
);

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ,
  muted           BOOLEAN NOT NULL DEFAULT false,
  hidden          BOOLEAN NOT NULL DEFAULT false,
  cleared_before  TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON public.conversation_participants (user_id);

-- 6. Messages Table
CREATE TABLE IF NOT EXISTS public.messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  client_message_id TEXT NOT NULL,
  body              TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, sender_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages (conversation_id, created_at DESC);

-- 7. Abuse Reports Table (Write-only for authenticated users)
CREATE TABLE IF NOT EXISTS public.abuse_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  target_user_id  UUID NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  message_id      UUID REFERENCES public.messages (id) ON DELETE SET NULL,
  category        TEXT NOT NULL CHECK (category IN ('spam', 'harassment', 'inappropriate', 'impersonation', 'other')),
  details         TEXT NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reporter_id <> target_user_id)
);

-- =============================================================================
-- Row-Level Security (RLS) Policies
-- =============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abuse_reports ENABLE ROW LEVEL SECURITY;

-- Profiles RLS
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR NOT public.is_blocked_between(auth.uid(), user_id));

CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- User Blocks RLS
CREATE POLICY blocks_select ON public.user_blocks
  FOR SELECT TO authenticated
  USING (blocker_id = auth.uid() OR blocked_id = auth.uid());

CREATE POLICY blocks_insert ON public.user_blocks
  FOR INSERT TO authenticated
  WITH CHECK (blocker_id = auth.uid() AND blocker_id <> blocked_id);

CREATE POLICY blocks_delete ON public.user_blocks
  FOR DELETE TO authenticated
  USING (blocker_id = auth.uid());

-- Friendships RLS
CREATE POLICY friendships_select ON public.friendships
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR recipient_id = auth.uid());

CREATE POLICY friendships_insert ON public.friendships
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND status = 'pending'
    AND NOT public.is_blocked_between(requester_id, recipient_id)
  );

CREATE POLICY friendships_update ON public.friendships
  FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid() AND status = 'pending')
  WITH CHECK (
    recipient_id = auth.uid()
    AND status = 'accepted'
    AND NOT public.is_blocked_between(requester_id, recipient_id)
  );

CREATE POLICY friendships_delete ON public.friendships
  FOR DELETE TO authenticated
  USING (requester_id = auth.uid() OR recipient_id = auth.uid());

-- Conversations RLS
CREATE POLICY conversations_select ON public.conversations
  FOR SELECT TO authenticated
  USING (pair_low = auth.uid() OR pair_high = auth.uid());

CREATE POLICY conversations_insert ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    (pair_low = auth.uid() OR pair_high = auth.uid())
    AND public.are_accepted_friends(pair_low, pair_high)
  );

-- Conversation Participants RLS
CREATE POLICY participants_select ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.pair_low = auth.uid() OR c.pair_high = auth.uid())
    )
  );

CREATE POLICY participants_insert ON public.conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.pair_low = auth.uid() OR c.pair_high = auth.uid())
        AND (user_id = c.pair_low OR user_id = c.pair_high)
    )
  );

CREATE POLICY participants_update ON public.conversation_participants
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Messages RLS: Strict participant + active friendship + non-blocked + sender = auth.uid()
CREATE POLICY messages_select ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id
        AND cp.user_id = auth.uid()
        AND (cp.cleared_before IS NULL OR messages.created_at > cp.cleared_before)
    )
  );

CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (c.pair_low = auth.uid() OR c.pair_high = auth.uid())
        AND public.are_accepted_friends(c.pair_low, c.pair_high)
    )
  );

-- Abuse Reports RLS: Users can submit reports as themselves, never read others' reports
CREATE POLICY reports_insert ON public.abuse_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid() AND reporter_id <> target_user_id);
