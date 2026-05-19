-- ==========================================
-- User Profiles Table
-- ==========================================
-- Maps auth.users to user metadata (email, display_name)
-- Enables REST API queries for user information
-- Date: 2026-05-20
-- Dependencies: auth.users (Supabase built-in)

-- ==========================================
-- 1. Create Profiles Table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid NOT NULL,
    email text,
    display_name text,
    avatar_url text,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT profiles_pkey PRIMARY KEY (id),
    CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 2. RLS Policies
-- ==========================================

-- Policy: Public profiles are viewable by everyone (for REST API queries)
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT 
USING (true);

-- Policy: Users can insert their own profile
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT 
WITH CHECK (id = (SELECT auth.uid()));

-- Policy: Users can update their own profile
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE 
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));

-- ==========================================
-- 4. Grant Table Permissions
-- ==========================================
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.profiles TO authenticated;
GRANT INSERT ON public.profiles TO authenticated;
GRANT UPDATE ON public.profiles TO authenticated;

-- ==========================================
-- 5. Trigger for updated_at
-- ==========================================
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- ==========================================
-- 5. Indexes for Query Performance
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_profiles_id ON public.profiles(id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_display_name ON public.profiles(display_name);

-- ==========================================
-- 6. Function to Sync Auth.users to Profiles
-- ==========================================
-- Automatically creates/updates profile when user is created or updated
CREATE OR REPLACE FUNCTION public.sync_user_to_profile()
RETURNS TRIGGER
SET search_path = public AS $$
BEGIN
    -- If user is being created/updated, sync to profiles table
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'display_name')
    ON CONFLICT (id) DO UPDATE SET
        email = NEW.email,
        display_name = NEW.raw_user_meta_data->>'display_name',
        updated_at = timezone('utc'::text, now());
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 7. Trigger on auth.users for auto-sync
-- ==========================================
-- Note: This trigger needs to be created on the auth schema (requires direct DB access)
-- For now, we'll handle initial seeding with a manual function
-- See migration notes below

-- ==========================================
-- 8. Seed Initial Profiles from Existing Users
-- ==========================================
-- Populate profiles table with existing auth.users
INSERT INTO public.profiles (id, email, display_name)
SELECT 
    u.id,
    u.email,
    COALESCE(u.raw_user_meta_data->>'display_name', u.email, 'Unknown User')
FROM auth.users u
WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = u.id
)
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    updated_at = timezone('utc'::text, now());

-- ==========================================
-- 9. Migration Notes
-- ==========================================
-- NOTE: To enable automatic sync of auth.users to profiles on user creation/signup:
-- 1. Use Supabase Dashboard: Database → Webhooks
-- 2. Create webhook on auth.users for INSERT/UPDATE events
-- 3. Call a function or endpoint to INSERT INTO public.profiles
-- 
-- OR: Manually create trigger on auth.users if you have direct DB access:
-- 
CREATE TRIGGER sync_auth_users_to_profiles
AFTER INSERT OR UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_user_to_profile();
--
-- For now, existing users are seeded above, and new users should add their
-- profile via the application's user settings page.
