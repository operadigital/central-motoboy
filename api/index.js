const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const serverless = require('serverless-http');
const webpush = require('web-push');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'central-motoboy-portable-key';
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || 'BIrqXEbrJbhivbzdvRm3X1KG1l34Wp_mPWJXWeE9I7m8YOsXTjleJjF63XJcFk745E6nHKn9zDZcWCZlTGBQTLQ';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || '72YdBWeQdVIyg2T5r_I_Be4f6HLAgdLNGUOn9LSLH0M';
const VAPID_EMAIL = 'mailto:admin@rodac.com.br';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uixlurredftlspfhibfe.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpeGx1cnJlZGZ0bHNwZmhpYmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMjc5MzMsImV4cCI6MjEwMTcwMzkzM30.86VEnJI9s6O3lyf_SXpJP0GZF0IQAD7GFpuVwK_jPjo';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpeGx1cnJlZGZ0bHNwZmhpYmZlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjEyNzkzMywiZXhwIjoyMTAxNzAzOTMzfQ.qmioE1lOBn04Qy9tgcqyCtZUgo-G87_q8KrGOVxMs0I';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// ============ CREATE TABLES IF NOT EXISTS ============
(async () => {
  try {
    await supabase.rpc('exec_sql', { sql: `
      CREATE TABLE IF NOT EXISTS clock_records (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        motoboy_id UUID,
        clock_in TIMESTAMP,
        clock_out TIMESTAMP,
        hours_worked DECIMAL(5,2),
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS withdrawals (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id UUID,
        amount DECIMAL(10,2),
        status TEXT DEFAULT 'PENDING',
        payment_type TEXT,
        pix_key TEXT,
        bank_name TEXT,
        agency TEXT,
        account_number TEXT,
        account_type TEXT,
        cpf TEXT,
        processed_at TIMESTAMP,
        paid_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    ` });
  } catch (e) {}
})();

// ============ SETTINGS (key-value) ============
const DEFAULT_SETTINGS = {
  base_price: 8.00,
  included_km: 10,
  price_per_km: 0.80,
  card_fee: 0.36,
  motoboy_base: 7.00,
  platform_commission: 1.00,
  max_active_deliveries: 3,
  min_withdrawal: 50
};
let cachedSettings = null;
async function getSettings() {
  if (cachedSettings) return cachedSettings;
  try {
    const { data } = await supabase.from('settings').select('key,value');
    if (data && data.length) {
      cachedSettings = {};
      data.forEach(s => { cachedSettings[s.key] = isNaN(s.value) ? s.value : parseFloat(s.value); });
    }
  } catch (e) {}
  if (!cachedSettings) cachedSettings = {};
  return { ...DEFAULT_SETTINGS, ...cachedSettings };
}
async function saveSettings(obj) {
  const rows = Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }));
  for (const row of rows) {
    await supabase.from('settings').upsert(row, { onConflict: 'key' });
  }
  cachedSettings = null;
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============ SSE ============
const sseClients = [];
function sendSSE(event, data) {
  const msg = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try { sseClients[i].res.write(msg); } catch(e) { sseClients.splice(i, 1); }
  }
}
app.get('/api/events', auth, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
  res.write(':\n\n');
  const client = { res, userId: req.user.id, role: req.user.role };
  sseClients.push(client);
  req.on('close', () => { const i = sseClients.indexOf(client); if (i >= 0) sseClients.splice(i, 1); });
});

// ============ HELPERS ============
function genToken(u) { return jwt.sign({ id: u.id, email: u.email, role: u.role, firstName: u.first_name, lastName: u.last_name }, JWT_SECRET, { expiresIn: '30d' }); }
function mapUser(u) { return u ? { id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name, phone: u.phone, role: u.role, status: u.status, profilePhoto: u.profile_photo, cpf: u.cpf, createdAt: u.created_at } : null; }
function auth(req, res, next) {
  const t = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!t) return res.status(401).json({ success: false, message: 'Token nao fornecido' });
  try { req.user = jwt.verify(t, JWT_SECRET); req.user.firstName = req.user.firstName || req.user.first_name; req.user.lastName = req.user.lastName || req.user.last_name; next(); } catch { return res.status(401).json({ success: false, message: 'Token invalido' }); }
}
function admin(req, res, next) { if (req.user?.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Sem permissao' }); next(); }

// ============ PUSH NOTIFICATIONS ============
async function sendPushToUser(userId, title, body, url) {
  try {
    const { data: subs } = await supabase.from('push_subscriptions').select('endpoint,p256dh,p256dh_key').eq('user_id', userId);
    if (!subs || !subs.length) return;
    const payload = JSON.stringify({ title, body, url: url || '/' });
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.p256dh_key } },
          payload
        );
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }
  } catch (e) {}
}
async function sendPushToRole(role, title, body, url) {
  try {
    const { data: users } = await supabase.from('users').select('id').eq('role', role);
    if (!users) return;
    for (const u of users) { await sendPushToUser(u.id, title, body, url); }
  } catch (e) {}
}

app.post('/api/push/subscribe', auth, async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys) return res.status(400).json({ success: false, message: 'Dados obrigatorios' });
    await supabase.from('push_subscriptions').upsert({ user_id: req.user.id, endpoint, p256dh: keys.p256dh, p256dh_key: keys.auth }, { onConflict: 'endpoint' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/push/unsubscribe', auth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/push/vapid-key', (req, res) => {
  res.json({ success: true, data: { publicKey: VAPID_PUBLIC } });
});

app.get('/api/push/test', auth, async (req, res) => {
  try {
    await sendPushToUser(req.user.id, 'Teste Rodae!', 'Se voce recebeu esta mensagem, as notificacoes push estao funcionando!', '/');
    res.json({ success: true, message: 'Push enviado' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============ AUTH ============
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const pw = password || 'x';
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (authError) {
      const { data: { user: signupUser }, error: signupErr } = await supabase.auth.signUp({ email, password: pw });
      if (signupErr) {
        const { data: existingUsers } = await supabase.from('users').select('*').eq('email', email).single();
        if (existingUsers) {
          const token = genToken(existingUsers);
          return res.json({ success: true, data: { user: mapUser(existingUsers), accessToken: token, refreshToken: token } });
        }
        return res.status(401).json({ success: false, message: 'Erro ao autenticar' });
      }
    }
    const supaUser = (authData && authData.user) || null;
    if (!supaUser) {
      const { data: existingUser } = await supabase.from('users').select('*').eq('email', email).single();
      if (existingUser) {
        const token = genToken(existingUser);
        return res.json({ success: true, data: { user: mapUser(existingUser), accessToken: token, refreshToken: token } });
      }
      return res.status(401).json({ success: false, message: 'Usuario nao encontrado' });
    }
    const { data: u } = await supabase.from('users').select('*').eq('id', supaUser.id).single();
    if (!u) {
      const { data: existingByEmail } = await supabase.from('users').select('*').eq('email', email).single();
      if (existingByEmail) {
        const token = genToken(existingByEmail);
        return res.json({ success: true, data: { user: mapUser(existingByEmail), accessToken: token, refreshToken: token } });
      }
      return res.status(401).json({ success: false, message: 'Usuario nao encontrado' });
    }
    const token = genToken(u);
    res.json({ success: true, data: { user: mapUser(u), accessToken: token, refreshToken: token } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, phone, firstName, lastName, role, password, cpf, vehicle, documents, photo } = req.body;
    const { data: existing } = await supabase.from('users').select('id').eq('email', email).single();
    if (existing) return res.status(400).json({ success: false, message: 'Email ja cadastrado' });
    const pw = password || 'x' + Date.now();
    const { data: authData, error: authErr } = await supabase.auth.signUp({ email, password: pw });
    const userId = authData?.user?.id || ('u' + Date.now());
    const { error: userErr } = await supabase.from('users').insert({ id: userId, email, phone, first_name: firstName, last_name: lastName, role: role || 'CLIENT', status: role === 'MOTOBOY' ? 'PENDING' : 'ACTIVE', profile_photo: photo || null, cpf: cpf || null });
    if (userErr) return res.status(500).json({ success: false, message: userErr.message });
    await supabase.from('wallets').insert({ user_id: userId, name: 'Principal', balance: 0 });
    if (role === 'MOTOBOY' && vehicle) {
      const { error: mbErr } = await supabase.from('motoboys').insert({ user_id: userId, vehicle_plate: vehicle.plate, vehicle_model: vehicle.model, vehicle_brand: vehicle.brand, vehicle_year: parseInt(vehicle.year) || 2023, vehicle_color: vehicle.color, vehicle_type: vehicle.type || 'MOTORCYCLE', documents: documents || null });
      if (mbErr) return res.status(500).json({ success: false, message: mbErr.message });
    }
    const { data: newUser } = await supabase.from('users').select('*').eq('id', userId).single();
    const token = genToken(newUser);
    res.status(201).json({ success: true, data: { user: mapUser(newUser), accessToken: token, refreshToken: token } });
    if (role === 'MOTOBOY') sendSSE('new-motoboy', { name: firstName + ' ' + lastName, email: email, vehicle: vehicle ? vehicle.brand + ' ' + vehicle.model : null });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const { data: u } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  if (!u) return res.status(404).json({ success: false });
  res.json({ success: true, data: mapUser(u) });
});

// ============ PASSWORD RECOVERY ============
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email obrigatorio' });
    console.log(`[PASSWORD RESET] Solicitacao de reset para: ${email}`);
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: '/' });
    if (error) {
      console.log(`[PASSWORD RESET] Erro: ${error.message}`);
    }
    res.json({ success: true, message: 'Se o email existir, voce recebera um link de recuperacao' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ success: false, message: 'Token e nova senha obrigatorios' });
    console.log(`[PASSWORD RESET] Tentativa de reset com token`);
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return res.status(400).json({ success: false, message: error.message });
    res.json({ success: true, message: 'Senha atualizada com sucesso' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============ ADMIN SETTINGS ============
app.get('/api/admin/settings', auth, admin, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({ success: true, data: settings });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/admin/settings', auth, admin, async (req, res) => {
  try {
    const allowed = ['base_price','included_km','price_per_km','card_fee','motoboy_base','platform_commission','max_active_deliveries','min_withdrawal'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    await saveSettings(updates);
    const settings = await getSettings();
    res.json({ success: true, data: settings });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============ ADMIN ============
app.get('/api/admin/stats', auth, admin, async (req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const { data: allDels } = await supabase.from('deliveries').select('status,total_price,commission_amount,created_at');
  const { data: allUsers } = await supabase.from('users').select('id,role');
  const { data: allMb } = await supabase.from('motoboys').select('id,is_online');
  const td = (allDels || []).filter(d => new Date(d.created_at) >= today);
  const comp = td.filter(d => d.status === 'DELIVERED');
  const canc = td.filter(d => d.status === 'CANCELLED');
  const active = (allDels || []).filter(d => ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT'].includes(d.status));
  const pend = (allDels || []).filter(d => d.status === 'PENDING');
  const onM = (allMb || []).filter(m => m.is_online).length;
  const deliveredAll = (allDels || []).filter(d => d.status === 'DELIVERED');
  res.json({ success: true, data: {
    totalUsers: (allUsers || []).length, totalClients: (allUsers || []).filter(u => u.role === 'CLIENT').length,
    totalMotoboys: (allMb || []).length, activeMotoboys: onM, offlineMotoboys: (allMb || []).length - onM,
    todayDeliveries: td.length, pendingDeliveries: pend.length, activeDeliveries: active.length,
    completedToday: comp.length, cancelledToday: canc.length,
    dailyRevenue: comp.reduce((s, d) => s + Number(d.total_price || 0), 0),
    monthlyRevenue: deliveredAll.reduce((s, d) => s + Number(d.total_price || 0), 0),
    commissions: comp.reduce((s, d) => s + Number(d.commission_amount || 0), 0),
    profit: comp.reduce((s, d) => s + Number(d.commission_amount || 0), 0)
  }});
});

app.get('/api/admin/motoboys', auth, admin, async (req, res) => {
  const { data: mbs } = await supabase.from('motoboys').select('*, users:user_id(*)');
  const data = (mbs || []).map(m => ({
    ...m, id: m.id, vehiclePlate: m.vehicle_plate, vehicleModel: m.vehicle_model, vehicleBrand: m.vehicle_brand,
    vehicleYear: m.vehicle_year, vehicleColor: m.vehicle_color, vehicleType: m.vehicle_type,
    averageRating: m.average_rating, completedDeliveries: m.completed_deliveries || 0,
    isOnline: m.is_online, approvedAt: m.approved_at, documents: m.documents,
    user: m.users ? mapUser(m.users) : null
  }));
  res.json({ success: true, data });
});

app.get('/api/admin/deliveries', auth, admin, async (req, res) => {
  let query = supabase.from('deliveries').select('*').order('created_at', { ascending: false });
  if (req.query.status) query = query.eq('status', req.query.status);
  const { data: d } = await query;
  const result = (d || []).map(x => ({
    id: x.id, trackingCode: x.tracking_code, clientId: x.client_id, motoboyId: x.motoboy_id,
    status: x.status, type: x.type,
    originAddress: x.origin_address, originNumber: x.origin_number, originNeighborhood: x.origin_neighborhood,
    originCity: x.origin_city, originState: x.origin_state,
    destinationAddress: x.destination_address, destinationNumber: x.destination_number, destinationNeighborhood: x.destination_neighborhood,
    destinationCity: x.destination_city, destinationState: x.destination_state,
    description: x.description, distance: x.distance, estimatedTime: x.estimated_time,
    totalPrice: Number(x.total_price), commissionAmount: Number(x.commission_amount),
    motoboyEarning: Number(x.motoboy_earning), paymentMethod: x.payment_method,
    createdAt: x.created_at, updatedAt: x.updated_at,
    scheduledFor: x.scheduled_for, proofPhoto: x.proof_photo,
    client: null, motoboy: null
  }));
  res.json({ success: true, data: result, meta: { total: result.length, page: 1, limit: 50, totalPages: 1 } });
});

app.get('/api/admin/map/locations', auth, admin, async (req, res) => {
  try {
    const { data: onMbs } = await supabase.from('motoboys').select('id,current_latitude,current_longitude,is_online,users:user_id(first_name,last_name)').eq('is_online', true).not('current_latitude', 'is', null);
    const { data: actDels } = await supabase.from('deliveries').select('id,tracking_code,status,current_latitude,current_longitude,origin_latitude,origin_longitude,destination_latitude,destination_longitude,origin_address,destination_address').in('status', ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT']);
    res.json({ success: true, data: {
      motoboys: (onMbs || []).filter(m => m.current_latitude && m.current_longitude).map(m => ({
        id: m.id, currentLatitude: m.current_latitude, currentLongitude: m.current_longitude,
        user: m.users ? { firstName: m.users.first_name, lastName: m.users.last_name } : { firstName: 'M', lastName: 'B' }
      })),
      activeDeliveries: (actDels || []).map(d => ({
        id: d.id, trackingCode: d.tracking_code, status: d.status,
        currentLatitude: d.current_latitude, currentLongitude: d.current_longitude,
        originLatitude: d.origin_latitude, originLongitude: d.origin_longitude,
        destinationLatitude: d.destination_latitude, destinationLongitude: d.destination_longitude,
        originAddress: d.origin_address, destinationAddress: d.destination_address
      }))
    }});
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/admin/financial', auth, admin, async (req, res) => {
  const { data: delivered } = await supabase.from('deliveries').select('total_price,commission_amount,motoboy_earning').eq('status', 'DELIVERED');
  const tot = (delivered || []).reduce((s, d) => s + Number(d.total_price || 0), 0);
  res.json({ success: true, data: {
    totalRevenue: tot, monthlyRevenue: tot,
    totalCommissions: (delivered || []).reduce((s, d) => s + Number(d.commission_amount || 0), 0),
    totalMotoboyEarnings: (delivered || []).reduce((s, d) => s + Number(d.motoboy_earning || 0), 0),
    profit: (delivered || []).reduce((s, d) => s + Number(d.commission_amount || 0), 0),
    pendingWithdrawalsAmount: 0, pendingWithdrawalsCount: 0
  }});
});

// ============ EXPORT CSV ============
app.get('/api/admin/export/deliveries', auth, admin, async (req, res) => {
  try {
    const { data: d } = await supabase.from('deliveries').select('*').order('created_at', { ascending: false });
    const headers = ['ID','Codigo de Rastreamento','ID Cliente','ID Motoboy','Status','Tipo','Endereco Origem','Endereco Destino','Distancia','Preco Total','Comissao','Ganho Motoboy','Forma de Pagamento','Criado Em'];
    const rows = (d || []).map(x => [
      x.id, x.tracking_code, x.client_id, x.motoboy_id || '', x.status, x.type,
      `${x.origin_address || ''} ${x.origin_number || ''} ${x.origin_neighborhood || ''} ${x.origin_city || ''} ${x.origin_state || ''}`.trim(),
      `${x.destination_address || ''} ${x.destination_number || ''} ${x.destination_neighborhood || ''} ${x.destination_city || ''} ${x.destination_state || ''}`.trim(),
      x.distance || '', x.total_price || '', x.commission_amount || '', x.motoboy_earning || '', x.payment_method || '', x.created_at || ''
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="entregas.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/admin/export/financial', auth, admin, async (req, res) => {
  try {
    const { data: d } = await supabase.from('deliveries').select('*').eq('status', 'DELIVERED').order('created_at', { ascending: false });
    const headers = ['ID','Codigo de Rastreamento','Preco Total','Valor Comissao','Ganho Motoboy','Forma de Pagamento','Criado Em'];
    const rows = (d || []).map(x => [
      x.id, x.tracking_code, x.total_price || 0, x.commission_amount || 0, x.motoboy_earning || 0, x.payment_method || '', x.created_at || ''
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="financeiro.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/admin/motoboys/:id/approve', auth, admin, async (req, res) => {
  await supabase.from('motoboys').update({ approved_at: new Date().toISOString() }).eq('id', req.params.id);
  const { data: mb } = await supabase.from('motoboys').select('*').eq('id', req.params.id).single();
  if (mb) await supabase.from('users').update({ status: 'ACTIVE' }).eq('id', mb.user_id);
  res.json({ success: true, data: mb });
});

app.put('/api/admin/motoboys/:id/reject', auth, admin, async (req, res) => {
  await supabase.from('motoboys').update({ rejected_at: new Date().toISOString(), rejection_reason: req.body.reason }).eq('id', req.params.id);
  const { data: mb } = await supabase.from('motoboys').select('*').eq('id', req.params.id).single();
  res.json({ success: true, data: mb });
});

// ============ DELIVERIES ============
app.get('/api/deliveries', auth, async (req, res) => {
  let query;
  if (req.user.role === 'CLIENT') {
    query = supabase.from('deliveries').select('*').eq('client_id', req.user.id).order('created_at', { ascending: false });
  } else if (req.user.role === 'MOTOBOY') {
    const { data: mb } = await supabase.from('motoboys').select('id').eq('user_id', req.user.id).single();
    if (mb) query = supabase.from('deliveries').select('*').or('motoboy_id.eq.' + mb.id + ',status.eq.PENDING').order('created_at', { ascending: false });
    else query = supabase.from('deliveries').select('*').eq('status', 'PENDING').order('created_at', { ascending: false });
  } else {
    query = supabase.from('deliveries').select('*').order('created_at', { ascending: false });
  }
  const { data: d } = await query.limit(50);
  const inCamaqua = (lat, lng) => lat >= -30.95 && lat <= -30.75 && lng >= -51.95 && lng <= -51.45;
  const result = (d || []).filter(x => {
    const oLat = parseFloat(x.origin_latitude), oLng = parseFloat(x.origin_longitude);
    const dLat = parseFloat(x.destination_latitude), dLng = parseFloat(x.destination_longitude);
    if (oLat && oLng && !inCamaqua(oLat, oLng)) return false;
    if (dLat && dLng && !inCamaqua(dLat, dLng)) return false;
    return true;
  }).map(x => ({
    id: x.id, trackingCode: x.tracking_code, clientId: x.client_id, motoboyId: x.motoboy_id,
    status: x.status, type: x.type,
    originAddress: x.origin_address, originNumber: x.origin_number, originNeighborhood: x.origin_neighborhood,
    originCity: x.origin_city, originState: x.origin_state,
    originLatitude: x.origin_latitude, originLongitude: x.origin_longitude,
    destinationAddress: x.destination_address, destinationNumber: x.destination_number, destinationNeighborhood: x.destination_neighborhood,
    destinationCity: x.destination_city, destinationState: x.destination_state,
    destinationLatitude: x.destination_latitude, destinationLongitude: x.destination_longitude,
    description: x.description, distance: x.distance, estimatedTime: x.estimated_time,
    totalPrice: Number(x.total_price), commissionAmount: Number(x.commission_amount),
    motoboyEarning: Number(x.motoboy_earning), paymentMethod: x.payment_method,
    createdAt: x.created_at,
    scheduledFor: x.scheduled_for, proofPhoto: x.proof_photo
  }));
  res.json({ success: true, data: result, meta: { total: result.length, page: 1, limit: 20, totalPages: 1 } });
});

app.get('/api/deliveries/available', auth, async (req, res) => {
  const { data: d } = await supabase.from('deliveries').select('*').eq('status', 'PENDING').order('created_at', { ascending: false });
  const inCamaqua = (lat, lng) => lat >= -30.95 && lat <= -30.75 && lng >= -51.95 && lng <= -51.45;
  const result = (d || []).filter(x => {
    const oLat = parseFloat(x.origin_latitude), oLng = parseFloat(x.origin_longitude);
    const dLat = parseFloat(x.destination_latitude), dLng = parseFloat(x.destination_longitude);
    if (oLat && oLng && !inCamaqua(oLat, oLng)) return false;
    if (dLat && dLng && !inCamaqua(dLat, dLng)) return false;
    return true;
  }).map(x => ({
    id: x.id, trackingCode: x.tracking_code, clientId: x.client_id, motoboyId: x.motoboy_id,
    status: x.status, type: x.type,
    originAddress: x.origin_address, originNumber: x.origin_number, originNeighborhood: x.origin_neighborhood,
    originCity: x.origin_city, originState: x.origin_state,
    originLatitude: x.origin_latitude, originLongitude: x.origin_longitude,
    destinationAddress: x.destination_address, destinationNumber: x.destination_number, destinationNeighborhood: x.destination_neighborhood,
    destinationCity: x.destination_city, destinationState: x.destination_state,
    destinationLatitude: x.destination_latitude, destinationLongitude: x.destination_longitude,
    description: x.description, distance: x.distance, estimatedTime: x.estimated_time,
    totalPrice: Number(x.total_price), commissionAmount: Number(x.commission_amount),     commissionPercent: 12.5,
    motoboyEarning: Number(x.motoboy_earning), paymentMethod: x.payment_method,
    createdAt: x.created_at,
    scheduledFor: x.scheduled_for, proofPhoto: x.proof_photo
  }));
  res.json({ success: true, data: result });
});

app.post('/api/deliveries', auth, async (req, res) => {
  try {
    const b = req.body;
    const code = 'CM' + Math.random().toString(36).substring(2, 10).toUpperCase();

    // Validar Camaqua (CEP 96180-000)
    const allowedCities = ['camaquã', 'camaqua'];
    const originCity = (b.originCity || '').trim().toLowerCase();
    const destCity = (b.destinationCity || '').trim().toLowerCase();
    if (!allowedCities.includes(originCity) || !allowedCities.includes(destCity)) {
      return res.status(400).json({ success: false, message: 'Entregas somente dentro de Camaquã (CEP 96180-000)' });
    }
    // Validar coordenadas dentro de Camaqua
    const inCamaqua = (lat, lng) => lat >= -30.95 && lat <= -30.75 && lng >= -51.95 && lng <= -51.45;
    const oLat = parseFloat(b.originLatitude), oLng = parseFloat(b.originLongitude);
    const dLat = parseFloat(b.destinationLatitude), dLng = parseFloat(b.destinationLongitude);
    if (oLat && oLng && !inCamaqua(oLat, oLng)) {
      return res.status(400).json({ success: false, message: 'Coordenadas de origem fora de Camaquã' });
    }
    if (dLat && dLng && !inCamaqua(dLat, dLng)) {
      return res.status(400).json({ success: false, message: 'Coordenadas de destino fora de Camaquã' });
    }

    // Dynamic pricing via OSRM
    let distanceKm = b.distance || 0;
    if (b.originLatitude && b.originLongitude && b.destinationLatitude && b.destinationLongitude) {
      try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${parseFloat(b.originLongitude)},${parseFloat(b.originLatitude)};${parseFloat(b.destinationLongitude)},${parseFloat(b.destinationLatitude)}`;
        const resp = await fetch(osrmUrl);
        const data = await resp.json();
        if (data.code === 'Ok' && data.routes && data.routes.length) {
          distanceKm = Math.round((data.routes[0].distance / 1000) * 10) / 10;
        }
      } catch (osrmErr) { /* fallback to provided distance */ }
    }
    if (!distanceKm || distanceKm <= 0) distanceKm = b.distance || 5;

    // Tabela de precificacao via settings
    const cfg = await getSettings();
    const basePrice = Number(cfg.base_price) || 8.00;
    const includedKm = Number(cfg.included_km) || 10;
    const pricePerKm = Number(cfg.price_per_km) || 0.80;
    const cardFeeValue = Number(cfg.card_fee) || 0.36;
    const motoboyBase = Number(cfg.motoboy_base) || 7.00;
    const platformCommission = Number(cfg.platform_commission) || 1.00;

    const extraKm = Math.max(0, Math.round((distanceKm - includedKm) * 10) / 10);
    const distancePrice = Math.round(extraKm * pricePerKm * 100) / 100;
    let totalPrice = Math.round((basePrice + distancePrice) * 100) / 100;
    const paymentMethod = b.paymentMethod || 'PIX';
    const cardFee = paymentMethod === 'CREDIT_CARD' ? cardFeeValue : 0;
    totalPrice = Math.round((totalPrice + cardFee) * 100) / 100;

    const motoboyEarning = Math.round((motoboyBase + distancePrice) * 100) / 100;
    const commissionAmount = platformCommission;

    const { data: d, error } = await supabase.from('deliveries').insert({
      tracking_code: code, client_id: req.user.id, status: 'PENDING', type: b.type || 'IMMEDIATE',
      origin_address: b.originAddress, origin_number: b.originNumber, origin_neighborhood: b.originNeighborhood,
      origin_city: b.originCity, origin_state: b.originState,
      origin_latitude: b.originLatitude, origin_longitude: b.originLongitude,
      destination_address: b.destinationAddress, destination_number: b.destinationNumber, destination_neighborhood: b.destinationNeighborhood,
      destination_city: b.destinationCity, destination_state: b.destinationState,
      destination_latitude: b.destinationLatitude, destination_longitude: b.destinationLongitude,
      description: b.description, distance: distanceKm, estimated_time: b.estimatedTime || Math.round(distanceKm * 3),
      base_price: basePrice, distance_price: distancePrice, total_price: totalPrice,
      commission_amount: commissionAmount, commission_percent: 12.5,
      motoboy_earning: motoboyEarning,
      payment_method: paymentMethod, payment_status: 'PENDING',
      scheduled_for: b.scheduledFor || null
    }).select().single();
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.status(201).json({ success: true, data: { id: d.id, trackingCode: d.tracking_code, totalPrice: Number(d.total_price), description: d.description } });
    sendSSE('new-delivery', { id: d.id, trackingCode: d.tracking_code, originAddress: d.origin_address, destinationAddress: d.destination_address, totalPrice: Number(d.total_price), description: d.description });
    sendPushToRole('MOTOBOY', 'Nova Entrega!', d.origin_address + ' → ' + d.destination_address, '/');
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/deliveries/:id/accept', auth, async (req, res) => {
  try {
    const { data: d } = await supabase.from('deliveries').select('*').eq('id', req.params.id).single();
    if (!d) return res.status(404).json({ success: false, message: 'Entrega nao encontrada' });
    if (d.status !== 'PENDING') return res.status(400).json({ success: false, message: 'Entrega ja foi aceita' });
    const { data: mb } = await supabase.from('motoboys').select('id').eq('user_id', req.user.id).single();
    if (!mb) return res.status(400).json({ success: false, message: 'Motoboy nao encontrado' });
    const { data: active } = await supabase.from('deliveries').select('id').eq('motoboy_id', mb.id).in('status', ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT']);
    const cfgMax = await getSettings();
    const maxActive = Number(cfgMax.max_active_deliveries) || 3;
    if (active && active.length >= maxActive) return res.status(400).json({ success: false, message: 'Limite maximo de '+maxActive+' entregas simultaneas atingido' });
    await supabase.from('deliveries').update({ status: 'ACCEPTED', motoboy_id: mb.id, accepted_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ success: true, data: { id: d.id, trackingCode: d.tracking_code, status: 'ACCEPTED' } });
    sendSSE('delivery-accepted', { id: d.id, trackingCode: d.tracking_code, motoboyName: req.user.firstName + ' ' + req.user.lastName });
    sendPushToUser(d.client_id, 'Entrega Aceita!', req.user.firstName + ' aceitou sua entrega ' + d.tracking_code, '/');
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/deliveries/:id/pickup', auth, async (req, res) => {
  try {
    const { data: d } = await supabase.from('deliveries').select('*').eq('id', req.params.id).single();
    if (!d) return res.status(404).json({ success: false, message: 'Entrega nao encontrada' });
    if (d.status !== 'ACCEPTED') return res.status(400).json({ success: false, message: 'Status invalido para coleta' });
    const { data: mb } = await supabase.from('motoboys').select('id').eq('user_id', req.user.id).single();
    if (!mb || d.motoboy_id !== mb.id) return res.status(403).json({ success: false, message: 'Sem permissao' });
    await supabase.from('deliveries').update({ status: 'PICKED_UP' }).eq('id', req.params.id);
    res.json({ success: true, data: { id: d.id, trackingCode: d.tracking_code, status: 'PICKED_UP' } });
    sendSSE('delivery-pickup', { id: d.id, trackingCode: d.tracking_code });
    sendPushToUser(d.client_id, 'Coleta Realizada!', 'Sua entrega ' + d.tracking_code + ' foi coletada', '/');
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/deliveries/:id/reject', auth, async (req, res) => {
  await supabase.from('deliveries').update({ status: 'PENDING', motoboy_id: null }).eq('id', req.params.id);
  res.json({ success: true });
});

app.put('/api/deliveries/:id/complete', auth, async (req, res) => {
  try {
    const { data: d } = await supabase.from('deliveries').select('*').eq('id', req.params.id).single();
    if (!d) return res.status(404).json({ success: false, message: 'Entrega nao encontrada' });

    await supabase.from('deliveries').update({ status: 'DELIVERED', delivered_at: new Date().toISOString(), payment_status: 'COMPLETED' }).eq('id', req.params.id);

    const motoboyEarning = Number(d.motoboy_earning || 0);
    const commission = Number(d.commission_amount || 0);

    if (motoboyEarning > 0 && d.motoboy_id) {
      const { data: mb } = await supabase.from('motoboys').select('id,user_id,completed_deliveries,daily_earnings,weekly_earnings,monthly_earnings').eq('id', d.motoboy_id).single();
      if (mb) {
        let { data: mWallet } = await supabase.from('wallets').select('id,balance').eq('user_id', mb.user_id).single();
        if (!mWallet) {
          const { data: nw } = await supabase.from('wallets').insert({ user_id: mb.user_id, name: 'Principal', balance: motoboyEarning }).select('id,balance').single();
          mWallet = nw;
        } else {
          const newBal = Number(mWallet.balance) + motoboyEarning;
          await supabase.from('wallets').update({ balance: newBal }).eq('id', mWallet.id);
          mWallet.balance = newBal;
        }
        await supabase.from('transactions').insert({
          wallet_id: mWallet.id, type: 'CREDIT', amount: motoboyEarning,
          balance: Number(mWallet.balance), description: 'Entrega #' + d.tracking_code + ' - Pagamento automatico'
        });
        await supabase.from('motoboys').update({
          completed_deliveries: (mb.completed_deliveries || 0) + 1,
          daily_earnings: Number(mb.daily_earnings || 0) + motoboyEarning,
          weekly_earnings: Number(mb.weekly_earnings || 0) + motoboyEarning,
          monthly_earnings: Number(mb.monthly_earnings || 0) + motoboyEarning,
          total_commissions: Number(mb.total_commissions || 0) + motoboyEarning
        }).eq('id', mb.id);
      }
    }

    if (commission > 0) {
      const { data: adminUser } = await supabase.from('users').select('id').eq('role', 'ADMIN').limit(1).single();
      if (adminUser) {
        let { data: pWallet } = await supabase.from('wallets').select('id,balance').eq('user_id', adminUser.id).single();
        if (!pWallet) {
          const { data: nw } = await supabase.from('wallets').insert({ user_id: adminUser.id, name: 'Plataforma', balance: commission }).select('id,balance').single();
          pWallet = nw;
        } else {
          const newBal = Number(pWallet.balance) + commission;
          await supabase.from('wallets').update({ balance: newBal }).eq('id', pWallet.id);
          pWallet.balance = newBal;
        }
        await supabase.from('transactions').insert({
          wallet_id: pWallet.id, type: 'CREDIT', amount: commission,
          balance: Number(pWallet.balance), description: 'Comissao entrega #' + d.tracking_code + ' (R$1,00)'
        });
      }
    }

    res.json({ success: true, data: { motoboyEarning, commission } });
    sendSSE('delivery-completed', { id: d.id, trackingCode: d.tracking_code, motoboyEarning, commission });
    sendPushToUser(d.client_id, 'Entrega Concluida!', 'Sua entrega ' + d.tracking_code + ' foi entregue com sucesso!', '/');
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/deliveries/:id/cancel', auth, async (req, res) => {
  await supabase.from('deliveries').update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() }).eq('id', req.params.id);
  res.json({ success: true });
});

// ============ STAR RATINGS ============
app.post('/api/deliveries/:id/rate', auth, async (req, res) => {
  try {
    const { score, comment } = req.body;
    if (!score || score < 1 || score > 5) return res.status(400).json({ success: false, message: 'Score deve ser entre 1 e 5' });
    const { data: d } = await supabase.from('deliveries').select('id,motoboy_id,client_id').eq('id', req.params.id).single();
    if (!d) return res.status(404).json({ success: false, message: 'Entrega nao encontrada' });
    if (d.status !== 'DELIVERED') return res.status(400).json({ success: false, message: 'So e possivel avaliar entregas concluidas' });
    if (d.client_id !== req.user.id) return res.status(403).json({ success: false, message: 'Somente o cliente pode avaliar' });
    if (!d.motoboy_id) return res.status(400).json({ success: false, message: 'Entrega sem motoboy atribuido' });

    const { data: existing } = await supabase.from('ratings').select('id').eq('delivery_id', d.id).eq('from_user_id', req.user.id).single();
    if (existing) return res.status(400).json({ success: false, message: 'Voce ja avaliou esta entrega' });

    const { data: rating, error } = await supabase.from('ratings').insert({
      delivery_id: d.id, from_user_id: req.user.id, to_user_id: d.motoboy_id,
      score: parseInt(score), comment: comment || null
    }).select().single();
    if (error) return res.status(500).json({ success: false, message: error.message });

    // Update motoboy average_rating and total_ratings
    const { data: mb } = await supabase.from('motoboys').select('id,average_rating,total_ratings').eq('user_id', d.motoboy_id).single();
    if (mb) {
      const prevTotal = mb.total_ratings || 0;
      const prevAvg = Number(mb.average_rating || 0);
      const newTotal = prevTotal + 1;
      const newAvg = Math.round(((prevAvg * prevTotal) + parseInt(score)) / newTotal * 10) / 10;
      await supabase.from('motoboys').update({ average_rating: newAvg, total_ratings: newTotal }).eq('id', mb.id);
    }

    res.status(201).json({ success: true, data: { id: rating.id, score: rating.score, comment: rating.comment } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/motoboys/:id/ratings', auth, async (req, res) => {
  try {
    const { data: mb } = await supabase.from('motoboys').select('id').eq('id', req.params.id).single();
    if (!mb) return res.status(404).json({ success: false, message: 'Motoboy nao encontrado' });
    const { data: ratings, error } = await supabase.from('ratings').select('*, from_user:from_user_id(first_name,last_name)').eq('to_user_id', mb.id).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, message: error.message });
    const result = (ratings || []).map(r => ({
      id: r.id, deliveryId: r.delivery_id, score: r.score, comment: r.comment, createdAt: r.created_at,
      fromUser: r.from_user ? { firstName: r.from_user.first_name, lastName: r.from_user.last_name } : null
    }));
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============ PROOF PHOTO ============
app.put('/api/deliveries/:id/proof', auth, async (req, res) => {
  try {
    const { photo } = req.body;
    if (!photo) return res.status(400).json({ success: false, message: 'Foto obrigatoria' });
    const { data: d, error } = await supabase.from('deliveries').update({ proof_photo: photo }).eq('id', req.params.id).select().single();
    if (error || !d) return res.status(404).json({ success: false, message: 'Entrega nao encontrada' });
    res.json({ success: true, data: { id: d.id, proofPhoto: d.proof_photo } });
    sendSSE('proof-uploaded', { deliveryId: d.id, trackingCode: d.tracking_code });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============ MOTOBOY ============
app.get('/api/motoboys', auth, async (req, res) => {
  const { data: m } = await supabase.from('motoboys').select('*').eq('user_id', req.user.id).single();
  if (!m) return res.status(404).json({ success: false });
  res.json({ success: true, data: {
    id: m.id, vehiclePlate: m.vehicle_plate, vehicleModel: m.vehicle_model, vehicleBrand: m.vehicle_brand,
    vehicleColor: m.vehicle_color, vehicleType: m.vehicle_type,
    isOnline: m.is_online, approvedAt: m.approved_at,
    averageRating: m.average_rating, totalRatings: m.total_ratings
  }});
});

app.put('/api/motoboys/online', auth, async (req, res) => {
  const { data: m } = await supabase.from('motoboys').select('id').eq('user_id', req.user.id).single();
  if (m) await supabase.from('motoboys').update({ is_online: true }).eq('id', m.id);
  res.json({ success: true, data: { isOnline: true } });
});

app.put('/api/motoboys/offline', auth, async (req, res) => {
  const { data: m } = await supabase.from('motoboys').select('id').eq('user_id', req.user.id).single();
  if (m) await supabase.from('motoboys').update({ is_online: false }).eq('id', m.id);
  res.json({ success: true, data: { isOnline: false } });
});

app.put('/api/motoboys/location', auth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'Coordenadas obrigatorias' });
    const { data: m } = await supabase.from('motoboys').select('id').eq('user_id', req.user.id).single();
    if (m) {
      const updateData = { current_latitude: parseFloat(lat), current_longitude: parseFloat(lng) };
      await supabase.from('motoboys').update(updateData).eq('id', m.id);
      const { data: activeDelivery } = await supabase.from('deliveries').select('id,client_id').eq('motoboy_id', m.id).in('status', ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT']).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (activeDelivery) {
        await supabase.from('deliveries').update({ current_latitude: parseFloat(lat), current_longitude: parseFloat(lng) }).eq('id', activeDelivery.id);
        sendSSE('delivery-location', { deliveryId: activeDelivery.id, clientId: activeDelivery.client_id, motoboyId: m.id, lat: parseFloat(lat), lng: parseFloat(lng), timestamp: new Date().toISOString() });
      }
      sendSSE('location-update', { motoboyId: m.id, userId: req.user.id, lat: parseFloat(lat), lng: parseFloat(lng), timestamp: new Date().toISOString() });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/motoboys/earnings', auth, async (req, res) => {
  const { data: m } = await supabase.from('motoboys').select('*').eq('user_id', req.user.id).single();
  if (!m) return res.status(404).json({ success: false });
  res.json({ success: true, data: {
    daily: Number(m.daily_earnings), weekly: Number(m.weekly_earnings), monthly: Number(m.monthly_earnings),
    totalCommissions: Number(m.total_commissions), totalDeliveries: m.total_deliveries,
    completedDeliveries: m.completed_deliveries, cancelledDeliveries: m.cancelled_deliveries,
    averageRating: Number(m.average_rating), acceptanceRate: Number(m.acceptance_rate)
  }});
});

app.get('/api/motoboys/deliveries', auth, async (req, res) => {
  const { data: m } = await supabase.from('motoboys').select('id').eq('user_id', req.user.id).single();
  if (!m) return res.json({ success: true, data: [] });
  const { data: d } = await supabase.from('deliveries').select('*').eq('motoboy_id', m.id).order('created_at', { ascending: false });
  const result = (d || []).map(x => ({
    id: x.id, trackingCode: x.tracking_code, status: x.status,
    originAddress: x.origin_address, destinationAddress: x.destination_address,
    originLatitude: x.origin_latitude, originLongitude: x.origin_longitude,
    destinationLatitude: x.destination_latitude, destinationLongitude: x.destination_longitude,
    totalPrice: Number(x.total_price), description: x.description,
    distance: x.distance, estimatedTime: x.estimated_time
  }));
  res.json({ success: true, data: result });
});

// ============ CLOCK IN/OUT (PONTO) ============
app.post('/api/motoboys/clock-in', auth, async (req, res) => {
  try {
    const { data: mb } = await supabase.from('motoboys').select('id,clocked_in').eq('user_id', req.user.id).single();
    if (!mb) return res.status(404).json({ success: false, message: 'Motoboy nao encontrado' });
    if (mb.clocked_in) return res.status(400).json({ success: false, message: 'Voce ja esta registrado como trabalhando' });
    const now = new Date().toISOString();
    await supabase.from('motoboys').update({ clock_in_at: now, clocked_in: true }).eq('id', mb.id);
    res.json({ success: true, data: { clockInAt: now } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/motoboys/clock-out', auth, async (req, res) => {
  try {
    const { data: mb } = await supabase.from('motoboys').select('id,clocked_in,clock_in_at').eq('user_id', req.user.id).single();
    if (!mb) return res.status(404).json({ success: false, message: 'Motoboy nao encontrado' });
    if (!mb.clocked_in) return res.status(400).json({ success: false, message: 'Voce nao esta registrado como trabalhando' });
    const now = new Date();
    const clockIn = new Date(mb.clock_in_at);
    const hoursWorked = Math.round((now - clockIn) / (1000 * 60 * 60) * 100) / 100;
    await supabase.from('motoboys').update({ clock_in_at: null, clocked_in: false }).eq('id', mb.id);
    const { data: record } = await supabase.from('clock_records').insert({
      motoboy_id: mb.id, clock_in: mb.clock_in_at, clock_out: now.toISOString(), hours_worked: hoursWorked
    }).select().single();
    res.json({ success: true, data: { hoursWorked, recordId: record?.id } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/motoboys/clock-history', auth, async (req, res) => {
  try {
    const { data: mb } = await supabase.from('motoboys').select('id').eq('user_id', req.user.id).single();
    if (!mb) return res.status(404).json({ success: false, message: 'Motoboy nao encontrado' });
    const { data: records, error } = await supabase.from('clock_records').select('*').eq('motoboy_id', mb.id).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, message: error.message });
    const result = (records || []).map(r => ({
      id: r.id, clockIn: r.clock_in, clockOut: r.clock_out, hoursWorked: Number(r.hours_worked), createdAt: r.created_at
    }));
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============ WALLETS ============
app.get('/api/wallets', auth, async (req, res) => {
  const { data: w } = await supabase.from('wallets').select('*').eq('user_id', req.user.id).single();
  const { data: tx } = w ? await supabase.from('transactions').select('*').eq('wallet_id', w.id).order('created_at', { ascending: false }) : { data: [] };
  const mappedTx = (tx || []).map(t => ({ id: t.id, type: t.type, amount: Number(t.amount), balance: Number(t.balance), description: t.description, createdAt: t.created_at }));
  res.json({ success: true, data: { wallet: w || { balance: 0, pendingBalance: 0, blockedBalance: 0 }, transactions: mappedTx } });
});

app.post('/api/wallets/withdraw', auth, async (req, res) => {
  try {
    const { amount, paymentType, pixKey, bankName, agency, accountNumber, accountType, cpf } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Valor invalido' });
    if (!paymentType) return res.status(400).json({ success: false, message: 'Tipo de pagamento obrigatorio' });

    const cfg = await getSettings();
    const minWithdrawal = Number(cfg.min_withdrawal) || 50;
    if (amount < minWithdrawal) return res.status(400).json({ success: false, message: 'Valor minimo para saque: R$ ' + minWithdrawal.toFixed(2) });

    const { data: w } = await supabase.from('wallets').select('id,balance').eq('user_id', req.user.id).single();
    if (!w) return res.status(404).json({ success: false, message: 'Carteira nao encontrada' });
    if (Number(w.balance) < amount) return res.status(400).json({ success: false, message: 'Saldo insuficiente' });

    const { data: pending } = await supabase.from('withdrawals').select('id').eq('user_id', req.user.id).eq('status', 'PENDING');
    if (pending && pending.length > 0) return res.status(400).json({ success: false, message: 'Voce ja tem um saque pendente' });

    const newBalance = Math.round((Number(w.balance) - amount) * 100) / 100;
    await supabase.from('wallets').update({ balance: newBalance }).eq('id', w.id);

    const { data: withdrawal, error } = await supabase.from('withdrawals').insert({
      user_id: req.user.id, amount, status: 'PENDING',
      payment_type: paymentType, pix_key: pixKey || null,
      bank_name: bankName || null, agency: agency || null,
      account_number: accountNumber || null, account_type: accountType || null,
      cpf: cpf || null
    }).select().single();
    if (error) throw error;

    await supabase.from('transactions').insert({
      wallet_id: w.id, type: 'DEBIT', amount,
      balance: newBalance, description: 'Saque solicitado - ' + (paymentType === 'PIX' ? 'PIX' : 'Transferencia Bancaria')
    });

    res.json({ success: true, data: { id: withdrawal.id, amount, status: 'PENDING' } });
    sendSSE('withdrawal-request', { userId: req.user.id, amount });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/wallets/withdrawals', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('withdrawals').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    const result = (data || []).map(w => ({
      id: w.id, amount: Number(w.amount), status: w.status, paymentType: w.payment_type,
      pixKey: w.pix_key, bankName: w.bank_name, createdAt: w.created_at, paidAt: w.paid_at
    }));
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============ ADMIN WITHDRAWALS ============
app.get('/api/admin/withdrawals', auth, admin, async (req, res) => {
  try {
    let query = supabase.from('withdrawals').select('*, users:user_id(first_name,last_name,email,phone)').order('created_at', { ascending: false });
    if (req.query.status) query = query.eq('status', req.query.status);
    const { data, error } = await query;
    if (error) throw error;
    const result = (data || []).map(w => ({
      id: w.id, amount: Number(w.amount), status: w.status, paymentType: w.payment_type,
      pixKey: w.pix_key, bankName: w.bank_name, agency: w.agency,
      accountNumber: w.account_number, accountType: w.account_type, cpf: w.cpf,
      user: w.users ? { firstName: w.users.first_name, lastName: w.users.last_name, email: w.users.email, phone: w.users.phone } : null,
      createdAt: w.created_at, paidAt: w.paid_at
    }));
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/admin/withdrawals/:id/approve', auth, admin, async (req, res) => {
  try {
    const { data: w } = await supabase.from('withdrawals').select('*').eq('id', req.params.id).single();
    if (!w) return res.status(404).json({ success: false, message: 'Saque nao encontrado' });
    if (w.status !== 'PENDING') return res.status(400).json({ success: false, message: 'Saque ja processado' });
    await supabase.from('withdrawals').update({ status: 'APPROVED', processed_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ success: true, data: { id: w.id, status: 'APPROVED' } });
    sendSSE('withdrawal-approved', { userId: w.user_id, amount: w.amount });
    sendPushToUser(w.user_id, 'Saque Aprovado!', 'Seu saque de R$ ' + Number(w.amount).toFixed(2) + ' foi aprovado', '/');
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/admin/withdrawals/:id/reject', auth, admin, async (req, res) => {
  try {
    const { data: w } = await supabase.from('withdrawals').select('*').eq('id', req.params.id).single();
    if (!w) return res.status(404).json({ success: false, message: 'Saque nao encontrado' });
    if (w.status !== 'PENDING') return res.status(400).json({ success: false, message: 'Saque ja processado' });

    const { data: wallet } = await supabase.from('wallets').select('id,balance').eq('user_id', w.user_id).single();
    if (wallet) {
      const newBal = Math.round((Number(wallet.balance) + Number(w.amount)) * 100) / 100;
      await supabase.from('wallets').update({ balance: newBal }).eq('id', wallet.id);
      await supabase.from('transactions').insert({
        wallet_id: wallet.id, type: 'CREDIT', amount: Number(w.amount),
        balance: newBal, description: 'Estorno saque recusado #' + w.id.substring(0, 8)
      });
    }
    await supabase.from('withdrawals').update({ status: 'REJECTED' }).eq('id', req.params.id);
    res.json({ success: true, data: { id: w.id, status: 'REJECTED' } });
    sendPushToUser(w.user_id, 'Saque Recusado', 'Seu saque de R$ ' + Number(w.amount).toFixed(2) + ' foi recusado. Valor estornado.', '/');
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/admin/withdrawals/:id/paid', auth, admin, async (req, res) => {
  try {
    const { data: w } = await supabase.from('withdrawals').select('*').eq('id', req.params.id).single();
    if (!w) return res.status(404).json({ success: false, message: 'Saque nao encontrado' });
    if (w.status !== 'APPROVED') return res.status(400).json({ success: false, message: 'Saque precisa estar aprovado' });
    await supabase.from('withdrawals').update({ status: 'PAID', paid_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ success: true, data: { id: w.id, status: 'PAID' } });
    sendPushToUser(w.user_id, 'Saque Pago!', 'Seu saque de R$ ' + Number(w.amount).toFixed(2) + ' foi processado', '/');
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============ AUTO PAYOUT (diario) ============
app.post('/api/admin/payouts/auto', auth, admin, async (req, res) => {
  try {
    const cfg = await getSettings();
    const minWithdrawal = Number(cfg.min_withdrawal) || 50;
    const { data: wallets } = await supabase.from('wallets').select('id,user_id,balance').gte('balance', minWithdrawal);
    if (!wallets || !wallets.length) return res.json({ success: true, data: { processed: 0 } });

    let processed = 0;
    for (const w of wallets) {
      const { data: pending } = await supabase.from('withdrawals').select('id').eq('user_id', w.user_id).eq('status', 'PENDING');
      if (pending && pending.length > 0) continue;

      const { data: mb } = await supabase.from('motoboys').select('pix_key,bank_name,account_number').eq('user_id', w.user_id).single();
      if (!mb || (!mb.pix_key && !mb.bank_name)) continue;

      const amount = Math.round(Number(w.balance) * 100) / 100;
      const newBalance = 0;
      await supabase.from('wallets').update({ balance: newBalance }).eq('id', w.id);
      await supabase.from('withdrawals').insert({
        user_id: w.user_id, amount, status: 'APPROVED',
        payment_type: mb.pix_key ? 'PIX' : 'BANK_TRANSFER',
        pix_key: mb.pix_key || null, bank_name: mb.bank_name || null,
        account_number: mb.account_number || null
      });
      await supabase.from('transactions').insert({
        wallet_id: w.id, type: 'DEBIT', amount,
        balance: newBalance, description: 'Payout automatico'
      });
      processed++;
      sendPushToUser(w.user_id, 'Payout Automatico!', 'R$ ' + amount.toFixed(2) + ' transferido automaticamente', '/');
    }
    res.json({ success: true, data: { processed } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============ DELIVERY ZONES ============
app.get('/api/zones', auth, (req, res) => {
  res.json({ success: true, data: [
    { id: 'z1', name: 'Centro', latMin: -30.9, latMax: -30.85, lngMin: -50.85, lngMax: -50.75 },
    { id: 'z2', name: 'Camaquã', latMin: -30.9, latMax: -30.8, lngMin: -50.9, lngMax: -50.7 }
  ]});
});

app.post('/api/deliveries/check-zone', auth, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ success: false, message: 'Coordenadas obrigatorias' });
    const lat = parseFloat(latitude), lng = parseFloat(longitude);
    const inZone = lat >= -30.9 && lat <= -30.8 && lng >= -50.9 && lng <= -50.7;
    res.json({ success: true, data: { inZone, zone: inZone ? 'Camaquã' : null, message: inZone ? 'Dentro da area de entrega' : 'Fora da area de entrega' } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============ COUPONS ============
app.post('/api/coupons/validate', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Codigo obrigatorio' });
    const coupons = { 'DESCONTO10': 10, 'DESCONTO20': 20, 'PRIMEIRA': 15 };
    const discount = coupons[code.toUpperCase()];
    if (!discount) return res.status(404).json({ success: false, message: 'Cupom invalido' });
    res.json({ success: true, data: { code: code.toUpperCase(), discountPercent: discount, message: `${discount}% de desconto aplicado` } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============ MOTOBOY PUBLIC PROFILE ============
app.get('/api/motoboys/:id/public', auth, async (req, res) => {
  try {
    const { data: mb } = await supabase.from('motoboys').select('id,average_rating,total_ratings,completed_deliveries,vehicle_plate,vehicle_model,vehicle_brand,vehicle_color,vehicle_type,users:user_id(first_name,last_name)').eq('id', req.params.id).single();
    if (!mb) return res.status(404).json({ success: false, message: 'Motoboy nao encontrado' });
    res.json({ success: true, data: {
      id: mb.id,
      firstName: mb.users?.first_name,
      lastName: mb.users?.last_name,
      averageRating: Number(mb.average_rating || 0),
      totalRatings: mb.total_ratings || 0,
      completedDeliveries: mb.completed_deliveries || 0,
      vehicle: { plate: mb.vehicle_plate, model: mb.vehicle_model, brand: mb.vehicle_brand, color: mb.vehicle_color, type: mb.vehicle_type }
    }});
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============ OUTROS ============
app.get('/api/deliveries/:id/tracking', auth, async (req, res) => {
  try {
    const { data: d } = await supabase.from('deliveries').select('*').eq('id', req.params.id).single();
    if (!d) return res.status(404).json({ success: false, message: 'Entrega nao encontrada' });
    let motoboyLocation = null;
    if (d.motoboy_id) {
      const { data: mb } = await supabase.from('motoboys').select('current_latitude,current_longitude,last_location_update,users:user_id(first_name,last_name)').eq('id', d.motoboy_id).single();
      if (mb && mb.current_latitude) {
        motoboyLocation = { lat: mb.current_latitude, lng: mb.current_longitude, lastUpdate: mb.last_location_update, name: mb.users ? mb.users.first_name + ' ' + mb.users.last_name : null };
      }
    }
    res.json({ success: true, data: {
      id: d.id, trackingCode: d.tracking_code, status: d.status,
      originLat: d.origin_latitude, originLng: d.origin_longitude,
      destLat: d.destination_latitude, destLng: d.destination_longitude,
      originAddress: d.origin_address, destinationAddress: d.destination_address,
      motoboyLocation
    }});
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/route', auth, async (req, res) => {
  try {
    const { origLat, origLng, destLat, destLng } = req.query;
    if (!origLat || !origLng || !destLat || !destLng) return res.status(400).json({ success: false, message: 'Coordenadas obrigatorias' });
    // Validar Camaquã (-30.95 a -30.75 lat, -51.95 a -51.45 lng)
    const inCamaqua = (lat, lng) => lat >= -30.95 && lat <= -30.75 && lng >= -51.95 && lng <= -51.45;
    if (!inCamaqua(parseFloat(origLat), parseFloat(origLng)) || !inCamaqua(parseFloat(destLat), parseFloat(destLng))) {
      return res.status(400).json({ success: false, message: 'Rota fora de Camaquã. Entregas somente na regiao de Camaquã/RS' });
    }
    const url = `https://router.project-osrm.org/route/v1/driving/${parseFloat(origLng)},${parseFloat(origLat)};${parseFloat(destLng)},${parseFloat(destLat)}?overview=full&geometries=geojson`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
      return res.json({ success: false, message: 'Rota nao encontrada' });
    }
    const route = data.routes[0];
    res.json({ success: true, data: {
      geometry: route.geometry,
      distance: route.distance,
      duration: route.duration
    }});
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/realtime/locations', auth, async (req, res) => {
  try {
    const { data: onMbs } = await supabase.from('motoboys').select('id,current_latitude,current_longitude,is_online,users:user_id(first_name,last_name)').eq('is_online', true).not('current_latitude', 'is', null);
    const { data: actDels } = await supabase.from('deliveries').select('id,tracking_code,status,motoboy_id,origin_latitude,origin_longitude,destination_latitude,destination_longitude,origin_address,destination_address').in('status', ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT']);
    const motoboys = (onMbs || []).filter(m => m.current_latitude && m.current_longitude).map(m => ({
      id: m.id, lat: m.current_latitude, lng: m.current_longitude,
      user: m.users ? { firstName: m.users.first_name, lastName: m.users.last_name } : null
    }));
    const deliveries = (actDels || []).map(d => ({
      id: d.id, trackingCode: d.tracking_code, status: d.status,
      originLat: d.origin_latitude, originLng: d.origin_longitude,
      destLat: d.destination_latitude, destLng: d.destination_longitude,
      originAddress: d.origin_address, destinationAddress: d.destination_address
    }));
    res.json({ success: true, data: { motoboys, deliveries } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/chat/rooms', auth, (req, res) => res.json({ success: true, data: [] }));

// ============ CHAT ============
app.post('/api/chat/:deliveryId/messages', auth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'Mensagem obrigatoria' });
    const { data: d } = await supabase.from('deliveries').select('id').eq('id', req.params.deliveryId).single();
    if (!d) return res.status(404).json({ success: false, message: 'Entrega nao encontrada' });
    const { data: msg, error } = await supabase.from('chat_messages').insert({
      delivery_id: req.params.deliveryId, sender_id: req.user.id, message
    }).select().single();
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.status(201).json({ success: true, data: { id: msg.id, deliveryId: msg.delivery_id, senderId: msg.sender_id, message: msg.message, createdAt: msg.created_at } });
    sendSSE('chat-message', { deliveryId: req.params.deliveryId, senderId: req.user.id, message: msg.message });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/chat/:deliveryId/messages', auth, async (req, res) => {
  try {
    const { data: messages, error } = await supabase.from('chat_messages')
      .select('*').eq('delivery_id', req.params.deliveryId)
      .order('created_at', { ascending: false }).limit(50);
    if (error) return res.status(500).json({ success: false, message: error.message });
    const result = (messages || []).reverse().map(m => ({
      id: m.id, deliveryId: m.delivery_id, senderId: m.sender_id, message: m.message, createdAt: m.created_at
    }));
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.get('/api/notifications', auth, (req, res) => res.json({ success: true, data: [], unreadCount: 0, meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }));

// ============ SHARE LOCATION ============
app.post('/api/share-location', auth, async (req, res) => {
  try {
    const { lat, lng, expiresInMinutes } = req.body;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'Coordenadas obrigatorias' });
    const id = 'loc_' + Math.random().toString(36).substring(2, 12);
    const expiresAt = new Date(Date.now() + (expiresInMinutes || 60) * 60 * 1000).toISOString();
    const { data, error } = await supabase.from('shared_locations').insert({
      id, user_id: req.user.id, lat: parseFloat(lat), lng: parseFloat(lng), expires_at: expiresAt
    }).select().single();
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.status(201).json({ success: true, data: { id, expiresAt, shareUrl: `/share-location/${id}` } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/share-location/:id', async (req, res) => {
  try {
    const { data: loc } = await supabase.from('shared_locations').select('*').eq('id', req.params.id).single();
    if (!loc) return res.status(404).json({ success: false, message: 'Link nao encontrado' });
    if (new Date(loc.expires_at) < new Date()) return res.status(410).json({ success: false, message: 'Link expirado' });
    res.json({ success: true, data: { lat: Number(loc.lat), lng: Number(loc.lng), expiresAt: loc.expires_at } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/reports/dashboard', auth, admin, async (req, res) => {
  const { data: delivered } = await supabase.from('deliveries').select('total_price,created_at').eq('status', 'DELIVERED');
  const { data: mbs } = await supabase.from('motoboys').select('*,users:user_id(first_name,last_name)').order('completed_deliveries', { ascending: false }).limit(5);
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dels = delivered || [];
  res.json({ success: true, data: {
    deliveries: {
      daily: dels.filter(d => new Date(d.created_at) >= todayStart).length,
      weekly: dels.filter(d => new Date(d.created_at) >= weekStart).length,
      monthly: dels.filter(d => new Date(d.created_at) >= monthStart).length
    },
    revenue: {
      daily: dels.filter(d => new Date(d.created_at) >= todayStart).reduce((s, d) => s + Number(d.total_price || 0), 0),
      weekly: dels.filter(d => new Date(d.created_at) >= weekStart).reduce((s, d) => s + Number(d.total_price || 0), 0),
      monthly: dels.reduce((s, d) => s + Number(d.total_price || 0), 0)
    },
    avgDeliveryTime: 22,
    topMotoboys: (mbs || []).map((m, i) => ({ ...m, rank: i + 1, averageRating: m.average_rating, completedDeliveries: m.completed_deliveries || 0, vehicleModel: m.vehicle_model, vehiclePlate: m.vehicle_plate, totalCommissions: m.total_commissions || 0, user: m.users ? { firstName: m.users.first_name, lastName: m.users.last_name } : { firstName: 'M', lastName: 'B' } }))
  }});
});

app.get('/api/coupons', auth, admin, (req, res) => {
  res.json({ success: true, data: [
    { id: 'cp1', code: 'BEMVINDO10', description: '10% desconto primeira entrega', type: 'PERCENTAGE', value: 10, minOrderValue: 20, maxDiscount: 15, maxUses: 100, currentUses: 23, isActive: true },
    { id: 'cp2', code: 'FRETE5', description: 'R$5 desconto', type: 'FIXED', value: 5, minOrderValue: 15, maxUses: 200, currentUses: 67, isActive: true }
  ]});
});

module.exports = app;
module.exports.handler = serverless(app);
