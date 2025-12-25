-- Add Stripe-related columns to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_subscribed BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0;

-- Create index for faster Stripe customer lookup
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id ON profiles(stripe_customer_id);

-- Function to increment message count
CREATE OR REPLACE FUNCTION increment_message_count(user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET message_count = COALESCE(message_count, 0) + 1
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION increment_message_count(UUID) TO authenticated;
