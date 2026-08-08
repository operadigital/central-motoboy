const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://postgres:Motoboy%40123@db.uixlurredftlspfhibfe.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await c.connect();
  console.log('Connected');
  
  const stmts = [
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      p256dh_key TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY`
  ];
  
  for (const s of stmts) {
    try {
      await c.query(s);
      console.log('OK:', s.substring(0, 60).replace(/\n/g, ' '));
    } catch (e) {
      console.log('WARN:', e.message.substring(0, 100));
    }
  }
  
  await c.end();
  console.log('Done!');
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
