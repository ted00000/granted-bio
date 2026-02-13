-- Fix infinite recursion in user_profiles RLS policies
-- The admin policies were querying user_profiles from within user_profiles policies

-- Drop the problematic admin policies that cause recursion
DROP POLICY IF EXISTS "Admins can read all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON user_profiles;

-- The basic user policies remain and work correctly:
-- "Users can read own profile" - USING (auth.uid() = id)
-- "Users can update own profile" - USING (auth.uid() = id)

-- For admin access, we'll use a service role key in server-side code instead
-- This avoids the recursion issue entirely
