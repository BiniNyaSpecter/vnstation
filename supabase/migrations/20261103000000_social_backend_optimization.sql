-- ============================================================================
-- Migration: 20261103000000_social_backend_optimization.sql
-- Purpose:
--   1. Add covering indexes for all foreign keys (resolving 0001_unindexed_foreign_keys).
--   2. Convert helper functions (generate_unique_friend_code, is_blocked_between,
--      are_accepted_friends) to SECURITY INVOKER and revoke PUBLIC/anon/authenticated
--      EXECUTE on internal trigger functions (resolving 0028 & 0029 security lints).
--   3. Auto-confirm desktop signups on auth.users and auto-provision public.profiles
--      via triggers so profiles and Friend Codes exist immediately upon signup.
--   4. Auto-provision auth.users stub via BEFORE INSERT trigger on public.profiles
--      so pre-existing Local Sandbox accounts can sync their Friend Codes to cloud.
--   5. Add public.sync_client_profile RPC for conflict-safe profile & Friend Code sync.
--   6. Optimize all 19 RLS policies to use (select auth.uid()) initPlans (resolving
--      all 0003_auth_rls_initplan lints) and support desktop client sync.
-- ============================================================================

-- 1. Add covering indexes for all foreign keys
CREATE INDEX IF NOT EXISTS idx_conversations_pair_high
  ON public.conversations (pair_high);

CREATE INDEX IF NOT EXISTS idx_messages_sender_id
  ON public.messages (sender_id);

CREATE INDEX IF NOT EXISTS idx_abuse_reports_reporter_id
  ON public.abuse_reports (reporter_id);

CREATE INDEX IF NOT EXISTS idx_abuse_reports_target_user_id
  ON public.abuse_reports (target_user_id);

CREATE INDEX IF NOT EXISTS idx_abuse_reports_message_id
  ON public.abuse_reports (message_id);

-- 2. Convert public helper functions to SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.generate_unique_friend_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  alphabet CONSTANT TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate TEXT;
  i INT;
  part_a TEXT;
  part_b TEXT;
  attempts INT := 0;
BEGIN
  LOOP
    attempts := attempts + 1;
    IF attempts > 30 THEN
      RAISE EXCEPTION 'Could not allocate a unique friend code after 30 attempts';
    END IF;

    part_a := '';
    part_b := '';
    FOR i IN 1..4 LOOP
      part_a := part_a || substr(alphabet, 1 + floor(random() * 32)::INT, 1);
      part_b := part_b || substr(alphabet, 1 + floor(random() * 32)::INT, 1);
    END LOOP;

    candidate := 'VNS-' || part_a || '-' || part_b;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE friend_code = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_blocked_between(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN user_a IS NULL OR user_b IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1
      FROM public.user_blocks b
      WHERE (b.blocker_id = user_a AND b.blocked_id = user_b)
         OR (b.blocker_id = user_b AND b.blocked_id = user_a)
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.are_accepted_friends(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN user_a IS NULL OR user_b IS NULL OR user_a = user_b THEN FALSE
    ELSE EXISTS (
      SELECT 1
      FROM public.friendships f
      WHERE f.pair_low  = LEAST(user_a, user_b)
        AND f.pair_high = GREATEST(user_a, user_b)
        AND f.status    = 'accepted'
    )
  END;
$$;

-- 3. Auth triggers: auto-confirm desktop signups & auto-create public.profiles
CREATE OR REPLACE FUNCTION public.handle_before_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN
    NEW.email_confirmed_at := timezone('utc', now());
  END IF;
  NEW.raw_user_meta_data := jsonb_set(
    COALESCE(NEW.raw_user_meta_data, '{}'::jsonb),
    '{email_verified}',
    'true'::jsonb,
    true
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_before_auth_user_created() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER on_auth_user_before_insert
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_before_auth_user_created();

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_raw_username TEXT;
  v_username TEXT;
  v_display_name TEXT;
  v_friend_code TEXT;
  v_avatar_preset TEXT;
  v_suffix TEXT;
BEGIN
  v_suffix := substr(replace(NEW.id::text, '-', ''), 1, 4);
  v_raw_username := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'username'), ''),
    regexp_replace(split_part(COALESCE(NEW.email, 'reader'), '@', 1), '[^a-zA-Z0-9_]', '_', 'g')
  );
  v_raw_username := substr(regexp_replace(v_raw_username, '[^a-zA-Z0-9_]', '_', 'g'), 1, 18);
  IF length(v_raw_username) < 3 THEN
    v_raw_username := 'reader_' || v_suffix;
  END IF;

  v_username := v_raw_username;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(v_username) AND user_id <> NEW.id) THEN
    v_username := substr(v_raw_username, 1, 18) || '_' || v_suffix;
  END IF;

  v_display_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''),
    v_raw_username
  );

  v_friend_code := upper(COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'friend_code'), ''), ''));
  IF v_friend_code !~ '^VNS-[A-Z0-9]{4}-[A-Z0-9]{4}$'
     OR EXISTS (SELECT 1 FROM public.profiles WHERE friend_code = v_friend_code AND user_id <> NEW.id) THEN
    v_friend_code := public.generate_unique_friend_code();
  END IF;

  v_avatar_preset := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'avatar_preset'), ''), 'aoko');
  IF v_avatar_preset NOT IN ('aoko', 'stella', 'kurisu', 'sakura', 'nocturne', 'ember') THEN
    v_avatar_preset := 'aoko';
  END IF;

  INSERT INTO public.profiles (
    user_id, username, display_name, friend_code, bio, avatar_preset, avatar_url,
    presence, currently_playing
  ) VALUES (
    NEW.id, v_username, v_display_name, v_friend_code, '', v_avatar_preset, NULL,
    'online', NULL
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

CREATE OR REPLACE FUNCTION public.ensure_profile_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id) THEN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at
    ) VALUES (
      NEW.user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      lower(NEW.username) || '_' || substr(replace(NEW.user_id::text, '-', ''), 1, 6) || '@vnstation.local',
      '',
      timezone('utc', now()),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'username', NEW.username,
        'display_name', NEW.display_name,
        'friend_code', NEW.friend_code,
        'email_verified', true
      ),
      false,
      false,
      COALESCE(NEW.created_at, timezone('utc', now())),
      timezone('utc', now())
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_profile_auth_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER on_profile_before_insert_ensure_auth_user
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_profile_auth_user();

-- 4. Conflict-safe profile upsert RPC (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.sync_client_profile(
  p_user_id UUID,
  p_username TEXT,
  p_display_name TEXT,
  p_friend_code TEXT,
  p_bio TEXT DEFAULT '',
  p_avatar_preset TEXT DEFAULT 'aoko',
  p_avatar_url TEXT DEFAULT NULL,
  p_presence TEXT DEFAULT 'online',
  p_currently_playing TEXT DEFAULT NULL,
  p_customization JSONB DEFAULT NULL,
  p_privacy JSONB DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_clean_code TEXT := upper(trim(p_friend_code));
  v_clean_username TEXT := trim(p_username);
  v_clean_display TEXT := substr(trim(COALESCE(NULLIF(p_display_name, ''), p_username)), 1, 48);
  v_clean_avatar TEXT := CASE
    WHEN p_avatar_preset IN ('aoko', 'stella', 'kurisu', 'sakura', 'nocturne', 'ember') THEN p_avatar_preset
    ELSE 'aoko'
  END;
  v_clean_presence TEXT := CASE
    WHEN p_presence IN ('online', 'away', 'offline') THEN p_presence
    ELSE 'online'
  END;
  v_result public.profiles;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  IF v_uid IS NOT NULL AND v_uid <> p_user_id THEN
    RAISE EXCEPTION 'Cannot sync profile for another user';
  END IF;

  IF v_clean_code !~ '^VNS-[A-Z0-9]{4}-[A-Z0-9]{4}$' THEN
    v_clean_code := public.generate_unique_friend_code();
  END IF;

  IF v_clean_username !~ '^[a-zA-Z0-9_]{3,24}$' THEN
    v_clean_username := 'reader_' || substr(replace(p_user_id::text, '-', ''), 1, 6);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = lower(v_clean_username)
      AND user_id <> p_user_id
  ) THEN
    v_clean_username := substr(v_clean_username, 1, 18) || '_' || substr(replace(p_user_id::text, '-', ''), 1, 4);
  END IF;

  UPDATE public.profiles
  SET friend_code = public.generate_unique_friend_code()
  WHERE friend_code = v_clean_code
    AND user_id <> p_user_id;

  INSERT INTO public.profiles (
    user_id, username, display_name, friend_code, bio, avatar_preset, avatar_url,
    presence, currently_playing, customization, privacy, updated_at
  ) VALUES (
    p_user_id,
    v_clean_username,
    v_clean_display,
    v_clean_code,
    substr(COALESCE(p_bio, ''), 1, 600),
    v_clean_avatar,
    p_avatar_url,
    v_clean_presence,
    p_currently_playing,
    COALESCE(p_customization, '{"theme":"midnight-console","layout":"myspace-classic","accentColor":"#9db4ff","backgroundUrl":null,"statusLine":"Reading visual novels on VNStation","nowListening":"","featuredVn":null,"favoriteVns":[],"featuredCharacter":null}'::jsonb),
    COALESCE(p_privacy, '{"profileVisibility":"friends","showOnlineStatus":true,"showCurrentlyPlaying":true,"showFriendsList":true,"featuredVnsVisibility":"friends","allowFriendRequestsByCode":true}'::jsonb),
    timezone('utc', now())
  )
  ON CONFLICT (user_id) DO UPDATE SET
    username          = EXCLUDED.username,
    display_name      = EXCLUDED.display_name,
    friend_code       = EXCLUDED.friend_code,
    bio               = EXCLUDED.bio,
    avatar_preset     = EXCLUDED.avatar_preset,
    avatar_url        = EXCLUDED.avatar_url,
    presence          = EXCLUDED.presence,
    currently_playing = EXCLUDED.currently_playing,
    customization     = COALESCE(p_customization, public.profiles.customization),
    privacy           = COALESCE(p_privacy, public.profiles.privacy),
    updated_at        = timezone('utc', now())
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- 5. Update all 19 RLS Policies in-place using ALTER POLICY to use (SELECT auth.uid())
--    initPlans and allow both authenticated and anon desktop client sessions.

-- PROFILES
ALTER POLICY profiles_select ON public.profiles
  TO anon, authenticated
  USING (
    (SELECT auth.uid()) IS NULL
    OR (SELECT auth.uid()) = user_id
    OR NOT public.is_blocked_between((SELECT auth.uid()), user_id)
  );

ALTER POLICY profiles_insert ON public.profiles
  TO anon, authenticated
  WITH CHECK (
    ((SELECT auth.uid()) = user_id)
    OR ((SELECT auth.uid()) IS NULL AND user_id IS NOT NULL AND friend_code ~ '^VNS-[A-Z0-9]{4}-[A-Z0-9]{4}$')
  );

ALTER POLICY profiles_update ON public.profiles
  TO anon, authenticated
  USING (
    ((SELECT auth.uid()) = user_id)
    OR ((SELECT auth.uid()) IS NULL AND user_id IS NOT NULL AND friend_code ~ '^VNS-[A-Z0-9]{4}-[A-Z0-9]{4}$')
  )
  WITH CHECK (
    ((SELECT auth.uid()) = user_id)
    OR ((SELECT auth.uid()) IS NULL AND user_id IS NOT NULL AND friend_code ~ '^VNS-[A-Z0-9]{4}-[A-Z0-9]{4}$')
  );

ALTER POLICY profiles_delete ON public.profiles
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- USER BLOCKS
ALTER POLICY blocks_select ON public.user_blocks
  TO anon, authenticated
  USING (
    (SELECT auth.uid()) IS NULL
    OR (SELECT auth.uid()) = blocker_id
    OR (SELECT auth.uid()) = blocked_id
  );

ALTER POLICY blocks_insert ON public.user_blocks
  TO anon, authenticated
  WITH CHECK (
    blocker_id <> blocked_id
    AND (
      (SELECT auth.uid()) = blocker_id
      OR ((SELECT auth.uid()) IS NULL AND blocker_id IS NOT NULL)
    )
  );

ALTER POLICY blocks_delete ON public.user_blocks
  TO anon, authenticated
  USING (
    (SELECT auth.uid()) = blocker_id
    OR ((SELECT auth.uid()) IS NULL AND blocker_id IS NOT NULL)
  );

-- FRIENDSHIPS
ALTER POLICY friendships_select ON public.friendships
  TO anon, authenticated
  USING (
    (SELECT auth.uid()) IS NULL
    OR (SELECT auth.uid()) = requester_id
    OR (SELECT auth.uid()) = recipient_id
  );

ALTER POLICY friendships_insert ON public.friendships
  TO anon, authenticated
  WITH CHECK (
    requester_id <> recipient_id
    AND status IN ('pending', 'accepted')
    AND NOT public.is_blocked_between(requester_id, recipient_id)
    AND (
      (SELECT auth.uid()) = requester_id
      OR ((SELECT auth.uid()) IS NULL AND requester_id IS NOT NULL)
    )
  );

ALTER POLICY friendships_update ON public.friendships
  TO anon, authenticated
  USING (
    (SELECT auth.uid()) = recipient_id
    OR (SELECT auth.uid()) = requester_id
    OR ((SELECT auth.uid()) IS NULL AND recipient_id IS NOT NULL)
  )
  WITH CHECK (
    status = 'accepted'
    AND NOT public.is_blocked_between(requester_id, recipient_id)
    AND (
      (SELECT auth.uid()) = recipient_id
      OR (SELECT auth.uid()) = requester_id
      OR ((SELECT auth.uid()) IS NULL AND recipient_id IS NOT NULL)
    )
  );

ALTER POLICY friendships_delete ON public.friendships
  TO anon, authenticated
  USING (
    (SELECT auth.uid()) = requester_id
    OR (SELECT auth.uid()) = recipient_id
    OR ((SELECT auth.uid()) IS NULL AND requester_id IS NOT NULL)
  );

-- CONVERSATIONS
ALTER POLICY conversations_select ON public.conversations
  TO anon, authenticated
  USING (
    (SELECT auth.uid()) IS NULL
    OR (SELECT auth.uid()) = pair_low
    OR (SELECT auth.uid()) = pair_high
  );

ALTER POLICY conversations_insert ON public.conversations
  TO anon, authenticated
  WITH CHECK (
    pair_low < pair_high
    AND NOT public.is_blocked_between(pair_low, pair_high)
    AND (
      (SELECT auth.uid()) = pair_low
      OR (SELECT auth.uid()) = pair_high
      OR ((SELECT auth.uid()) IS NULL AND pair_low IS NOT NULL)
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'conversations' AND policyname = 'conversations_update'
  ) THEN
    CREATE POLICY conversations_update ON public.conversations
      FOR UPDATE TO anon, authenticated
      USING (
        (SELECT auth.uid()) = pair_low
        OR (SELECT auth.uid()) = pair_high
        OR ((SELECT auth.uid()) IS NULL AND pair_low IS NOT NULL)
      )
      WITH CHECK (
        pair_low < pair_high
        AND (
          (SELECT auth.uid()) = pair_low
          OR (SELECT auth.uid()) = pair_high
          OR ((SELECT auth.uid()) IS NULL AND pair_low IS NOT NULL)
        )
      );
  END IF;
END;
$$;

-- CONVERSATION PARTICIPANTS
ALTER POLICY participants_select ON public.conversation_participants
  TO anon, authenticated
  USING (
    (SELECT auth.uid()) IS NULL
    OR (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.pair_low = (SELECT auth.uid()) OR c.pair_high = (SELECT auth.uid()))
    )
  );

ALTER POLICY participants_insert ON public.conversation_participants
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.pair_low = user_id OR c.pair_high = user_id)
        AND (
          (SELECT auth.uid()) IS NULL
          OR c.pair_low = (SELECT auth.uid())
          OR c.pair_high = (SELECT auth.uid())
        )
    )
  );

ALTER POLICY participants_update ON public.conversation_participants
  TO anon, authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR ((SELECT auth.uid()) IS NULL AND user_id IS NOT NULL)
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    OR ((SELECT auth.uid()) IS NULL AND user_id IS NOT NULL)
  );

-- MESSAGES
ALTER POLICY messages_select ON public.messages
  TO anon, authenticated
  USING (
    (SELECT auth.uid()) IS NULL
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.pair_low = (SELECT auth.uid()) OR c.pair_high = (SELECT auth.uid()))
    )
  );

ALTER POLICY messages_insert ON public.messages
  TO anon, authenticated
  WITH CHECK (
    char_length(trim(body)) BETWEEN 1 AND 2000
    AND (
      (SELECT auth.uid()) = sender_id
      OR ((SELECT auth.uid()) IS NULL AND sender_id IS NOT NULL)
    )
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.pair_low = sender_id OR c.pair_high = sender_id)
        AND NOT public.is_blocked_between(c.pair_low, c.pair_high)
    )
  );

-- ABUSE REPORTS
ALTER POLICY reports_insert ON public.abuse_reports
  TO anon, authenticated
  WITH CHECK (
    reporter_id <> target_user_id
    AND (
      (SELECT auth.uid()) = reporter_id
      OR ((SELECT auth.uid()) IS NULL AND reporter_id IS NOT NULL)
    )
  );

-- 6. Grants for anon and authenticated roles (governed by RLS above)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO anon, authenticated;
GRANT DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversations TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversation_participants TO anon, authenticated;
GRANT SELECT, INSERT ON public.messages TO anon, authenticated;
GRANT INSERT ON public.abuse_reports TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_unique_friend_code() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_blocked_between(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.are_accepted_friends(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_client_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) TO anon, authenticated;
