const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const serverless = require('serverless-http');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'central-motoboy-portable-key';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uixlurredftlspfhibfe.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpeGx1cnJlZGZ0bHNwZmhpYmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMjc5MzMsImV4cCI6MjEwMTcwMzkzM30.86VEnJI9s6O3lyf_SXpJP0GZF0IQAD7GFpuVwK_jPjo';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpeGx1cnJlZGZ0bHNwZmhpYmZlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjEyNzkzMywiZXhwIjoyMTAxNzAzOTMzfQ.qmioE1lOBn04Qy9tgcqyCtZUgo-G87_q8KrGOVxMs0I';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

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
    client: null, motoboy: null
  }));
  res.json({ success: true, data: result, meta: { total: result.length, page: 1, limit: 50, totalPages: 1 } });
});

app.get('/api/admin/map/locations', auth, admin, async (req, res) => {
  try {
    const { data: onMbs } = await supabase.from('motoboys').select('id,current_latitude,current_longitude,is_online,users:user_id(first_name,last_name)').eq('is_online', true).not('current_latitude', 'is', null);
    const { data: actDels } = await supabase.from('deliveries').select('id,tracking_code,status,current_latitude,current_longitude').in('status', ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT']).not('current_latitude', 'is', null);
    res.json({ success: true, data: {
      motoboys: (onMbs || []).filter(m => m.current_latitude && m.current_longitude).map(m => ({
        id: m.id, currentLatitude: m.current_latitude, currentLongitude: m.current_longitude,
        user: m.users ? { firstName: m.users.first_name, lastName: m.users.last_name } : { firstName: 'M', lastName: 'B' }
      })),
      activeDeliveries: (actDels || []).filter(d => d.current_latitude && d.current_longitude).map(d => ({
        id: d.id, trackingCode: d.tracking_code, status: d.status,
        currentLatitude: d.current_latitude, currentLongitude: d.current_longitude
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
    createdAt: x.created_at
  }));
  res.json({ success: true, data: result, meta: { total: result.length, page: 1, limit: 20, totalPages: 1 } });
});

app.get('/api/deliveries/available', auth, async (req, res) => {
  const { data: d } = await supabase.from('deliveries').select('*').eq('status', 'PENDING').order('created_at', { ascending: false });
  const result = (d || []).map(x => ({
    id: x.id, trackingCode: x.tracking_code, clientId: x.client_id, motoboyId: x.motoboy_id,
    status: x.status, type: x.type,
    originAddress: x.origin_address, originNumber: x.origin_number, originNeighborhood: x.origin_neighborhood,
    originCity: x.origin_city, originState: x.origin_state,
    destinationAddress: x.destination_address, destinationNumber: x.destination_number, destinationNeighborhood: x.destination_neighborhood,
    destinationCity: x.destination_city, destinationState: x.destination_state,
    description: x.description, distance: x.distance, estimatedTime: x.estimated_time,
    totalPrice: Number(x.total_price), commissionAmount: Number(x.commission_amount), commissionPercent: 20,
    motoboyEarning: Number(x.motoboy_earning), paymentMethod: x.payment_method,
    createdAt: x.created_at
  }));
  res.json({ success: true, data: result });
});

app.post('/api/deliveries', auth, async (req, res) => {
  try {
    const b = req.body;
    const code = 'CM' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const price = 25 + Math.floor(Math.random() * 20);
    const { data: d, error } = await supabase.from('deliveries').insert({
      tracking_code: code, client_id: req.user.id, status: 'PENDING', type: b.type || 'IMMEDIATE',
      origin_address: b.originAddress, origin_number: b.originNumber, origin_neighborhood: b.originNeighborhood,
      origin_city: b.originCity, origin_state: b.originState,
      origin_latitude: b.originLatitude, origin_longitude: b.originLongitude,
      destination_address: b.destinationAddress, destination_number: b.destinationNumber, destination_neighborhood: b.destinationNeighborhood,
      destination_city: b.destinationCity, destination_state: b.destinationState,
      destination_latitude: b.destinationLatitude, destination_longitude: b.destinationLongitude,
      description: b.description, distance: b.distance || 5, estimated_time: b.estimatedTime || 20,
      base_price: 10, distance_price: 15, total_price: price,
      commission_amount: Math.round(price * 0.2 * 100) / 100, commission_percent: 20,
      motoboy_earning: Math.round(price * 0.8 * 100) / 100,
      payment_method: b.paymentMethod || 'PIX', payment_status: 'PENDING'
    }).select().single();
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.status(201).json({ success: true, data: { id: d.id, trackingCode: d.tracking_code, totalPrice: Number(d.total_price), description: d.description } });
    sendSSE('new-delivery', { id: d.id, trackingCode: d.tracking_code, originAddress: d.origin_address, destinationAddress: d.destination_address, totalPrice: Number(d.total_price), description: d.description });
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
    await supabase.from('deliveries').update({ status: 'ACCEPTED', motoboy_id: mb.id, accepted_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ success: true, data: { id: d.id, trackingCode: d.tracking_code, status: 'ACCEPTED' } });
    sendSSE('delivery-accepted', { id: d.id, trackingCode: d.tracking_code, motoboyName: req.user.firstName + ' ' + req.user.lastName });
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
          balance: Number(pWallet.balance), description: 'Comissao entrega #' + d.tracking_code + ' (20%)'
        });
      }
    }

    res.json({ success: true, data: { motoboyEarning, commission } });
    sendSSE('delivery-completed', { id: d.id, trackingCode: d.tracking_code, motoboyEarning, commission });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/deliveries/:id/cancel', auth, async (req, res) => {
  await supabase.from('deliveries').update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() }).eq('id', req.params.id);
  res.json({ success: true });
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
    totalPrice: Number(x.total_price), description: x.description,
    distance: x.distance, estimatedTime: x.estimated_time
  }));
  res.json({ success: true, data: result });
});

// ============ WALLETS ============
app.get('/api/wallets', auth, async (req, res) => {
  const { data: w } = await supabase.from('wallets').select('*').eq('user_id', req.user.id).single();
  const { data: tx } = w ? await supabase.from('transactions').select('*').eq('wallet_id', w.id).order('created_at', { ascending: false }) : { data: [] };
  const mappedTx = (tx || []).map(t => ({ id: t.id, type: t.type, amount: Number(t.amount), balance: Number(t.balance), description: t.description, createdAt: t.created_at }));
  res.json({ success: true, data: { wallet: w || { balance: 0, pendingBalance: 0, blockedBalance: 0 }, transactions: mappedTx } });
});

app.post('/api/wallets/withdraw', auth, async (req, res) => {
  res.json({ success: true, data: { id: 'w' + Date.now(), status: 'PENDING', ...req.body } });
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
app.get('/api/notifications', auth, (req, res) => res.json({ success: true, data: [], unreadCount: 0, meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }));

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
    topMotoboys: (mbs || []).map((m, i) => ({ ...m, rank: i + 1, user: m.users ? { firstName: m.users.first_name, lastName: m.users.last_name } : { firstName: 'M', lastName: 'B' } }))
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
