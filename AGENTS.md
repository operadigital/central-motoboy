# Central Motoboy - Contexto do Projeto

## Arquitetura
- **Plataforma SaaS** para gerenciamento de entregas de motoboy
- **Unified deploy**: frontend + backend no mesmo repo, deploy no Vercel
- Frontend: SPA unica em `public/index.html` (~2600 linhas)
- Backend: Express.js como Vercel Serverless Function em `api/index.js`
- Banco: Supabase PostgreSQL

## Repositorios
- **Producao:** `operadigital/central-motoboy` (unificado)
- **Obsolete:** `operadigital/central-motoboy-backend` (nao usar)

## Stack
- Frontend: HTML/CSS/JS vanilla (sem frameworks)
- Backend: Express.js + serverless-http
- Banco: Supabase (PostgreSQL)
- Deploy: Vercel (serverless)
- Auth: JWT + Supabase Auth
- Real-time: SSE (Server-Sent Events)
- Mapas: Leaflet.js v1.9.4 + OSRM (router.project-osrm.org)
- Geocoding: Nominatim (OpenStreetMap)

## Supabase
- Projeto: `uixlurredftlspfhibfe`
- URL: `https://uixlurredftlspfhibfe.supabase.co`
- Anon key: ver AGENTS.md original ou ambiente
- Service role key: ver AGENTS.md original ou ambiente
- Postgres password: `Motoboy@123`

## Usuarios
- **Admin (Supabase Auth):** empwilliamtavares@gmail.com / inf4j61imc5f15
- **Testes:** cliente@email.com/cliente123, motoboy@email.com/motoboy123, joao@email.com/joao123, pedro@email.com/pedro123

## GitHub
- User: William Tavares
- Email: operadigital.link@gmail.com

## Coordenadas Camaqua RS
- **DEFAULT_LAT=-30.8511, DEFAULT_LNG=-51.8075** (centro de Camaqua)
- **Bounds Validacao:** lat -30.95 a -30.75, lng -51.95 a -51.45
- **Nominatim viewbox:** -51.95,-30.95,-51.45,-30.75
- NAO MUDAR essas coordenadas - estao corretas via Nominatim API

## Estrutura de Arquivos
```
central-motoboy/
├── api/
│   └── index.js          # Backend Express (serverless)
├── public/
│   ├── index.html         # SPA completa (~2600 linhas)
│   ├── manifest.json      # PWA manifest
│   ├── service-worker.js  # PWA service worker
│   └── icon.svg           # Icone do app
├── vercel.json            # Rotas: /api/* → serverless, /* → public/
├── package.json           # deps: express, cors, jsonwebtoken, @supabase/supabase-js, serverless-http, web-push
├── AGENTS.md              # Este arquivo
└── .gitignore
```

## Rotas do Backend (`api/index.js`)
- `POST /api/auth/login` — Login (Supabase Auth + JWT)
- `POST /api/auth/register` — Registro
- `GET /api/auth/me` — Dados do usuario logado
- `POST /api/auth/forgot-password` — Recuperacao de senha
- `POST /api/auth/reset-password` — Reset de senha
- `GET /api/dashboard/admin` — KPIs admin
- `GET /api/deliveries` — Listar entregas (filtro por role)
- `GET /api/deliveries/available` — Entregas disponiveis (motoboy)
- `POST /api/deliveries` — Criar entrega (client) com validacao Camaqua
- `PUT /api/deliveries/:id/accept` — Aceitar entrega (motoboy, max 3 simultaneas)
- `PUT /api/deliveries/:id/pickup` — Confirmar coleta
- `PUT /api/deliveries/:id/complete` — Completar entrega (pagamento automatico 80/20)
- `PUT /api/deliveries/:id/cancel` — Cancelar entrega
- `PUT /api/deliveries/:id/location` — Atualizar localizacao da entrega
- `GET /api/deliveries/:id` — Detalhes da entrega
- `GET /api/motoboys` — Dados do motoboy
- `PUT /api/motoboys/online` / `offline` — Toggle status
- `PUT /api/motoboys/location` — Atualizar localizacao GPS
- `GET /api/motoboys/earnings` — Ganhos do motoboy
- `GET /api/motoboys/deliveries` — Entregas do motoboy
- `GET /api/wallets` — Carteira + transacoes
- `POST /api/wallets/withdraw` — Saque
- `GET /api/route` — Rota OSRM (com retry no frontend)
- `POST /api/rate` — Avaliar entrega
- `POST /api/motoboys/documents` — Upload documentos
- `POST /api/upload/photo` — Upload foto
- `GET /api/events` — SSE para notificacoes real-time
- `GET /api/admin/motoboys` — Gerenciar motoboys (admin)
- `PUT /api/admin/motoboys/:id/approve` — Aprovar motoboy
- `PUT /api/admin/motoboys/:id/reject` — Rejeitar motoboy
- `GET /api/reports/dashboard` — Relatorios admin
- `GET /api/reports/financial` — Exportar CSV financeiro
- `GET /api/coupons` — Cupons
- `POST /api/coupons` — Criar cupom (admin)
- `PUT /api/coupons/:id` — Editar cupom
- `DELETE /api/coupons/:id` — Deletar cupom
- `GET /api/admin/map/locations` — Localizacao motoboys + entregas (admin)
- `POST /api/admin/notifications/test` — Testar push
- `POST /api/push/subscribe` — Subscribe push
- `POST /api/push/test` — Testar push
- `GET /api/messages/:deliveryId` — Mensagens do chat
- `POST /api/messages/:deliveryId` — Enviar mensagem

## Tabelas Supabase
- `users` — id, email, first_name, last_name, phone, role (ADMIN/CLIENT/MOTOBOY), status, profile_photo, cpf, created_at
- `motoboys` — id, user_id, vehicle_plate/model/brand/color/type, is_online, approved_at, document_*/photo_*, average_rating, total_ratings, completed_deliveries, daily/weekly/monthly_earnings, total_commissions, current_latitude, current_longitude, last_location_update, acceptance_rate, cancelled_deliveries
- `wallets` — id, user_id, name, balance, pending_balance, blocked_balance
- `transactions` — id, wallet_id, type (CREDIT/DEBIT), amount, balance, description, created_at
- `deliveries` — id, tracking_code, client_id, motoboy_id, status (PENDING/ACCEPTED/PICKED_UP/IN_TRANSIT/DELIVERED/CANCELLED), type, origin_*/destination_* (address,city,state,neighborhood,latitude,longitude), current_latitude, current_longitude, description, distance, estimated_time, base_price, distance_price, total_price, commission_amount, commission_percent, motoboy_earning, payment_method, payment_status, scheduled_at, created_at, accepted_at, picked_up_at, delivered_at, cancelled_at
- `ratings` — id, delivery_id, from_user_id, to_user_id, score, comment, created_at
- `messages` — id, delivery_id, sender_id, text, created_at
- `coupons` — id, code, discount_percent, active, max_uses, used_count, expires_at, created_at
- `delivery_photos` — id, delivery_id, user_id, photo_url, type, created_at
- `push_subscriptions` — id, user_id, endpoint, p256dh, auth, created_at

## Fluxo de Entrega (Uber-like)
1. Cliente cria entrega com endereco origem/destino + numero
2. Autocomplete Nominatim busca enderecos de Camaqua
3. Preview de rota OSRM no mapa ao selecionar origem/destino
4. Motoboy aceita (max 3 simultaneas) → rota verde ate coleta
5. Motoboy confirma coleta → rota vermelha ate destino
6. Motoboy confirma entrega → pagamento automatico
7. Status: PENDING → ACCEPTED → PICKED_UP → IN_TRANSIT → DELIVERED

## Fluxo de Pagamento Automatico
Quando motoboy clica "Concluir" (`PUT /api/deliveries/:id/complete`):
1. Busca entrega no banco
2. Atualiza status para DELIVERED + payment_status COMPLETED
3. Credita carteira do motoboy com 80% do valor (CREDIT)
4. Credita carteira do admin (plataforma) com 20% do valor (CREDIT)
5. Cria transacoes em ambas as carteiras
6. Atualiza estatisticas do motoboy
7. Envia SSE notification

## Sistema de Rotas (Precisao)
- OSRM com **retry 3x** no frontend antes de fallback
- Fallback: linha reta tracejada + aviso "Rota aproximada"
- **GPS obrigatorio** para motoboy desenhar rota (nao usa centro da cidade)
- **fitBounds** inclui rota inteira + markers + margem
- Preview de rota no mapa do cliente usa OSRM (nao linha reta)
- Mapa do admin mostra rotas das entregas ativas
- Mapa do motoboy mostra rota ate coleta/entrega

## Autocomplete Endereco (Estilo Uber)
- Barra de busca com icone e placeholder "Buscar endereco..."
- Nominatim API com viewbox Camaqua + bounded=1
- **Busca inteligente**: separa numero do endereco antes de buscar
- Digitar "Rua Central 123" → busca "Rua Central" → preenche numero automatico
- Loading animado durante busca
- Opcao "Usar: [endereco digitado]" sempre disponivel
- Seleciona endereco → preenche rua, bairro, numero e mostra no mapa
- Fecha ao tocar fora

## Mapas
- **createMap(containerId, options)** — Cria mapa com maxBounds Camaqua, minZoom 12, maxZoom 18
- **destroyMap(containerId)** — Destroi mapa e limpa markers
- **clearMarkers(containerId)** — Remove todos os markers
- **addMarker(containerId, lat, lng, options)** — Adiciona marker com id, color, emoji, tooltip, popup
- **removeMarker(containerId, markerId)** — Remove marker por id
- **fitMapToMarkers(containerId)** — Ajusta view para todos os markers
- **centerMap(containerId, lat, lng, zoom)** — Centraliza mapa
- **requestGPS(success, error)** — Solicita GPS com high accuracy
- **addUserLocationMarker(containerId, lat, lng)** — Marker azul pulsante do usuario
- **isInCamaqua(lat, lng)** — Valida se coordenadas estao em Camaqua

## Mapas do App
- **client-new-map** — Criar entrega (autocomplete + clique para origem/destino)
- **client-tracking-map** — Rastrear entrega ativa (motoboy ao vivo + rota)
- **motoboy-map** — Dashboard motoboy (GPS + entregas ativas + rotas)
- **admin-realtime-map** — Dashboard admin (todos motoboys + entregas em tempo real)
- **route-history-map** — Historico de rotas do motoboy

## Layout Mobile
- Header iOS glassmorphism com backdrop-blur
- Bottom nav bar (max 5 itens)
- Touch feedback (scale .97)
- Modal bottom sheets com drag handle
- Safe area insets (notch)
- Viewport lock (sem zoom, sem scroll bounce)
- Background #f2f2f7 (padrao iOS)
- Grid responsivo: CSS classes grid2, grid3, grid5 com !important

## Layout Desktop
- Sidebar fixa 260px com emoji icons
- Main content `width:calc(100vw - 260px)`
- KPIs em grid 4 colunas
- Graficos Chart.js

## Textos (PT-BR)
- Todos os textos da interface estao em Portugues Brasil
- CSV headers em portugues (Codigo de Rastreamento, Preco Total, etc.)
- Mensagens de erro em portugues
- Sem auto-logout por inatividade

## Conhecido
- iOS requer Apple Developer ($99/yr) — nao implementado
- Android APK precisa Android Studio — usuario nao tem
- PWA funcional mas usuario queria APK nativo

## Deploy
1. Push para GitHub (`operadigital/central-motoboy`)
2. Vercel faz deploy automatico
3. Variaveis de ambiente no Vercel: JWT_SECRET, SUPABASE_URL, SUPABASE_ANON, SUPABASE_SERVICE

## Nota para Futuras Sessoes
Para continuar o projeto, perguntar ao usuario:
1. "O que voce quer mudar/adicionar?"
2. Ler os arquivos atuais se precisar de contexto
3. Fazer alteracoes e dar push (deploy automatico no Vercel)
