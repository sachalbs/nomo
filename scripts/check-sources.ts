// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function main() {
  // Get recent messages with sources (any)
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, sources, created_at')
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Found', data?.length || 0, 'messages');

  data?.forEach((msg, idx) => {
    console.log('\n[Message ' + (idx + 1) + '] created:', msg.created_at);
    console.log('sources:', JSON.stringify(msg.sources, null, 2));
  });
}

main();
