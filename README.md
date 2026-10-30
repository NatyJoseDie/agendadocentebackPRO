# ⚙️ Agenda Docente PRO — Backend

**Stack:** Node.js + Express | **Deploy:** Render  
**Base de datos:** Supabase (PostgreSQL)  
**Repositorio Frontend:** [AgendaDocenteProFront](https://github.com/NatyJoseDie/AgendaDocenteProFront)

---

## 🗂️ Descripción General

API REST que sirve al frontend de Agenda Docente PRO. Gestiona autenticación (vía Supabase Auth), datos de docentes, alumnos, asistencias, escuelas, informes, suscripciones y pagos con Mercado Pago.

---

## 🚀 Historial de Desarrollo

---

### 📅 29 de Octubre de 2026

#### 💳 Integración con Mercado Pago

- Instalado SDK oficial: `npm install mercadopago`
- Creado `src/config/mercadopago.js`: Inicializa `MercadoPagoConfig` con el Access Token de producción.
- Creado `src/routes/pagos.js` con los endpoints:
  - `POST /api/pagos/crear-preferencia`: Genera preferencia de pago con los items, precios y metadatos del plan (mensual/anual, PRO/Premium).
  - `POST /api/pagos/webhook`: Recibe notificaciones de MP, verifica el pago, activa el plan en la tabla `docentes` y registra el cobro en la tabla `pagos`.
  - `GET /api/pagos/estado`: Devuelve el plan y estado de suscripción actual del docente autenticado.

#### 💰 Precios de Lanzamiento

| Plan    | Mensual   | Anual      |
|---------|-----------|------------|
| PRO     | .500    | .000    |
| Premium | .000    | .000    |

> Vigentes 6 meses desde el 29/10/2026. Luego pasan a precios completos.

#### 🏷️ Programa Beta — Pase VIP Cuatrimestral (10 Docentes Pioneros)

Se configuró un trigger en Supabase que detecta los primeros 10 registros (excluyendo a la fundadora) y les asigna automáticamente:
- `plan = 'premium'`
- `trial_ends_at = NOW() + INTERVAL '120 days'` (4 meses)
- `is_premium = true`

**Flujo de vencimiento:**
1. Día 120: Cuenta pasa a modo Solo Lectura (30 días de gracia).
2. Día 140: Aviso por mail/WhatsApp "quedan 10 días".
3. Día 150: Datos archivados definitivamente.

#### 🗃️ Cambios en Base de Datos (Supabase)

- **Tabla `pagos`** (NUEVA): Registra cada cobro aprobado de Mercado Pago.
  - Campos: `id`, `docente_id`, `mp_payment_id`, `monto`, `plan`, `ciclo`, `estado`, `fecha_pago`, `created_at`.
- **Constraint `docentes.plan`**: Actualizado para aceptar los valores: `'gratuito'`, `'pro'`, `'premium'`.
- **Limpieza de datos**: Se eliminaron todos los registros de prueba de la tabla `docentes` (excepto la fundadora `nbarzotti6@gmail.com`).
- **Limpieza de copias de seguridad**: Se eliminaron registros huérfanos de `copias_seguridad` dejando solo los de la fundadora.

#### 👑 Panel Administrativo — Rutas Exclusivas para la Dueña

- Creado `src/routes/admin.js` con middleware `requireAdmin` (bloquea a cualquier email que no sea el de Natalia):
  - `GET /api/admin/metricas`: Retorna:
    - Total recaudado (pagos aprobados de MP).
    - Total de docentes registrados.
    - Distribución: VIP activos, PRO, Premium, Free, Vencidos.
    - Lista completa de docentes con estado, días restantes y datos de plan.
    - Historial de pagos aprobados.
  - `POST /api/admin/modificar-docente`: Permite cambiar el plan de cualquier docente o agregarle días extra (para uso manual de la dueña).

- Actualizado `src/routes/index.js`: Montados los routers `/pagos` y `/admin`.

#### 🔐 Seguridad del Panel Administrativo

- Emails de admin autorizados hardcodeados en el backend:
  - `nbarzotti6@gmail.com`
  - `natalia@agendadocente.com`
  - `admin@agendadocente.com`
- Cualquier otro usuario que intente acceder a `/api/admin/*` recibe un `403 Forbidden`.

#### 👩‍💼 Fundadora / Administradora (nbarzotti6@gmail.com)

- Plan: Founder, Premium permanente, sin vencimiento.
- Acceso exclusivo al panel `/admin`.
- Sus datos nunca se borran en limpiezas de prueba.

#### 🔁 Git Push — Deploy automático a Render

- commit: feat: Mercado Pago, panel admin, trigger VIP beta, modo solo lectura
- Archivos nuevos: `src/config/mercadopago.js`, `src/routes/pagos.js`, `src/routes/admin.js`
- Archivos modificados: `package.json`, `.env`, `src/routes/index.js`, `schema/schema.sql`

---

## 🏗️ Estructura del Proyecto

`
src/
├── config/
│   ├── supabase.js          # supabaseAdmin + supabaseForUser
│   └── mercadopago.js       # MercadoPagoConfig ★ NUEVO
├── middleware/
│   └── auth.js              # requireAuth (JWT Supabase)
├── routes/
│   ├── index.js             # Router principal ★ ACTUALIZADO
│   ├── pagos.js             # Checkout + Webhook + Estado MP ★ NUEVO
│   ├── admin.js             # Métricas y gestión manual ★ NUEVO
│   └── ...
└── server.js
`

---

## ⚙️ Variables de Entorno (.env)

`nv
PORT=3000
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=xxxx
SUPABASE_SERVICE_ROLE_KEY=xxxx
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-xxxx
`

---

## 📌 Pendientes / Próximos Pasos

- [ ] Probar webhook de MP apuntando a la URL de Render en producción.
- [ ] Implementar envío de email/WhatsApp automático al día 120, 140 y 150 del VIP.
- [ ] Configurar cron job para pasar cuentas vencidas a modo Solo Lectura automáticamente.
- [ ] Invitar a los 10 docentes beta pioneros.
