-- Central Motoboy - Database Migrations
-- Run these in Supabase SQL Editor

-- Photo proof + scheduled deliveries + dynamic pricing
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS proof_photo TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMP;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS base_price DECIMAL(10,2);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS distance_price DECIMAL(10,2);

-- Chat system
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  delivery_id UUID REFERENCES deliveries(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
