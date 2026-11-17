const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Read .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('Error: .env.local file not found!');
  process.exit(1);
}

const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return acc;
  const [k, ...v] = trimmed.split('=');
  if (k && v) acc[k.trim()] = v.join('=').trim();
  return acc;
}, {});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY missing in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function seedProduction() {
  console.log('=== SEEDING PRODUCTION SUPABASE ===');
  console.log('Target Supabase URL:', supabaseUrl);

  const email = 'purchase@tsphere.net';
  const password = 'admin@Technosphere.com';
  const fullName = 'Technosphere Procurement';

  // Cleanup old dummy users if present
  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
  if (!listError && usersData?.users) {
    const oldUsers = usersData.users.filter(u => u.email === 'admin@bizzgrow.com' || u.email === 'admin@admin.com');
    for (const oldUser of oldUsers) {
      await supabase.from('profiles').delete().eq('id', oldUser.id);
      await supabase.auth.admin.deleteUser(oldUser.id);
      console.log(`[AUTH] Cleaned up legacy user ${oldUser.email}`);
    }
  }

  // 1. Create or fetch Auth User
  let userId = null;
  const { data: refreshedUsersData } = await supabase.auth.admin.listUsers();
  if (refreshedUsersData?.users) {
    const existingUser = refreshedUsersData.users.find(u => u.email === email);
    if (existingUser) {
      userId = existingUser.id;
      console.log(`[AUTH] Admin user found: ${email} (ID: ${userId})`);
    }
  }

  if (!userId) {
    const { data: createData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });

    if (createError) {
      console.error('[AUTH] Failed to create user:', createError.message);
    } else {
      userId = createData.user.id;
      console.log(`[AUTH] Successfully created user: ${email} (ID: ${userId})`);
    }
  }

  if (!userId) {
    console.error('[AUTH] Could not establish user ID. Stopping.');
    return;
  }

  // 2. Check and seed public.profiles
  const { error: profileCheckError } = await supabase.from('profiles').select('id').limit(1);
  if (profileCheckError && profileCheckError.code === 'PGRST205') {
    console.log('\n[WARNING] Database tables (public.profiles, etc.) do not exist yet on Supabase Cloud.');
    console.log('Please execute the consolidated migration script (supabase/full_schema_fresh.sql) in the Supabase Dashboard SQL Editor.');
    console.log('Once executed, re-run this seed script to populate profiles, categories, and settings!');
    return;
  }

  // Upsert profile
  const { error: profileUpsertError } = await supabase.from('profiles').upsert({
    id: userId,
    full_name: fullName,
    email: email,
    role: 'admin',
    updated_at: new Date().toISOString()
  });

  if (profileUpsertError) {
    console.error('[PROFILES] Failed to upsert profile:', profileUpsertError.message);
  } else {
    console.log(`[PROFILES] Successfully initialized admin profile for ${email}`);
  }

  console.log('\n[CLEAN SLATE] No default categories, vendors, leads, or system settings were seeded.');
  console.log('[CLEAN SLATE] All tables are completely fresh and ready for production input.');
  console.log('\n=== PRODUCTION ADMIN INITIALIZATION COMPLETED ===');
}

seedProduction().catch(err => {
  console.error('Fatal error initializing production admin:', err);
});

