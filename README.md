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

### 📅 6 de Noviembre de 2026 — 09:57 (Argentina)

#### ✅ Prueba de 14 días, límites del Plan Gratuito y notificaciones

- Ejecutada en Supabase `20261105_standard_trial_14_days.sql`; la usuaria confirmó que el trigger `docentes_asignar_prueba_estandar` está activo.
- Ejecutada en Supabase la migración `20261106_free_plan_resource_selection.sql`; Supabase respondió `Success`.
- Verificada la tabla `docentes`: 1 perfil, 0 requieren selección de recursos y 0 selecciones confirmadas. No se afectaron cuentas adicionales.
- Regla acordada para quienes terminan la gracia: si superan 1 escuela o 2 cursos, eligen qué conservar activo; la selección queda fija en el Plan Gratuito y los demás datos se conservan bloqueados. Contratar un plan restablece el acceso.
- Preparado el flujo de selección en `agendaDoceteFRONT/src/components/FreePlanSelectionGate.jsx` y sus restricciones de acceso. Build del frontend exitoso; pruebas del backend exitosas (8/8).
- Actualizada `INSTRUCCIONES_FRONTEND.md` para pedir una campanita con contador de notificaciones no leídas y un panel dentro de la app. El backend ya ofrece la API, pero la campana visual aún debe implementarse en el frontend. Push móvil sigue pendiente.
- Los cambios de código están en los worktrees locales; no se confirmó commit ni despliegue de estos cambios.

---

### 📅 4 de Noviembre de 2026 — 16:14 (Argentina)

#### ✅ Migración, permisos de Supabase y verificación de producción

- Ejecutada en Supabase la migración `schema/migrations/20261104_subscription_write_protection.sql`, que configura el período de solo lectura, la activación de suscripciones y las notificaciones VIP.
- Corregidos permisos faltantes para que `service_role` pueda consultar y actualizar `docentes`, y consultar `pagos`. Los permisos de actualización directa de docentes para `authenticated` permanecen revocados.
- Confirmado que el proceso diario de vencimientos consulta Supabase y termina sin errores.
- Verificados los endpoints de producción:
  - `GET /api/health` responde `status: "ok"`.
  - `GET /api/health/ready` responde `status: "ready"` con base de datos, pagos y notificaciones disponibles.
- Desplegada en Render la versión `56e4d4d`, con actualizaciones compatibles de dependencias. El último reporte de Render indicó 6 vulnerabilidades (5 moderadas y 1 alta); no se aplicó `npm audit fix --force`.

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
1. Al vencer los 4 meses: Cuenta pasa a modo Solo Lectura durante 30 días.
2. Día 140: Aviso dentro de la agenda y por email si Resend está configurado.
3. Al finalizar los 30 días de gracia: Aviso dentro de la agenda y por email si Resend está configurado; la cuenta pasa al plan gratuito y conserva sus datos.

El backend inicia diariamente el proceso de vencimientos al arrancar. Las escrituras de cuentas con un plan pago vencido quedan bloqueadas durante la gracia.
Los avisos se guardan de forma idempotente en `notificaciones_docente` y pueden
consultarse desde `GET /api/notificaciones`. WhatsApp no se integra en esta etapa.

#### 🎁 Prueba estándar para nuevas cuentas

La migración `schema/migrations/20261105_standard_trial_14_days.sql` ya se ejecutó
en Supabase. Su trigger asigna a cada perfil nuevo no VIP y no administrativo un
plan PRO por 14 días. No modifica perfiles existentes ni altera el beneficio de
120 días de los 10 docentes VIP.

Si la persona no activa un plan al vencer la prueba, su cuenta queda en solo lectura
durante 30 días y luego pasa al plan gratuito, conservando sus datos.
La migración `schema/migrations/20261106_free_plan_resource_selection.sql` también
se ejecutó en Supabase; verificación de perfiles realizada el 6 de noviembre de
2026: ninguno requería selección en ese momento.
Si al terminar la gracia hay más de 1 escuela o 2 cursos activos, la docente deberá
elegir una escuela y hasta dos cursos; esa elección no se podrá cambiar mientras
permanezca en el plan gratuito. Los demás datos se conservan y quedan bloqueados.
La selección se solicita al pasar de una suscripción PRO/Premium vencida al plan
gratuito; no se activa retroactivamente para cuentas gratuitas preexistentes.
Al contratar un plan, se restablece el acceso completo.

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

```env
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://DOMINIO-PUBLICO-DEL-FRONTEND
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=xxxx
SUPABASE_SERVICE_ROLE_KEY=xxxx
MERCADO_PAGO_ACCESS_TOKEN=TEST-xxxx
MERCADO_PAGO_WEBHOOK_SECRET=xxxx
MERCADO_PAGO_ENVIRONMENT=sandbox
FRONTEND_URL=https://DOMINIO-PUBLICO-DEL-FRONTEND
BACKEND_PUBLIC_URL=https://DOMINIO-PUBLICO-DE-RENDER
RESEND_API_KEY=re_xxxx
RESEND_FROM_EMAIL=Agenda Docente <avisos@tu-dominio-verificado.com>
RESEND_REPLY_TO_EMAIL=tu-correo-de-soporte@gmail.com
```

---

## 🔧 Configuración de producción y verificación

Copiá `.env.example` a `.env` en desarrollo. En Render configurá los mismos valores
desde **Environment**; nunca subas credenciales al repositorio.

```env
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://DOMINIO-PUBLICO-DEL-FRONTEND
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=xxxx
SUPABASE_SERVICE_ROLE_KEY=xxxx
MERCADO_PAGO_ACCESS_TOKEN=TEST-xxxx
MERCADO_PAGO_WEBHOOK_SECRET=xxxx
MERCADO_PAGO_ENVIRONMENT=sandbox
FRONTEND_URL=https://DOMINIO-PUBLICO-DEL-FRONTEND
BACKEND_PUBLIC_URL=https://DOMINIO-PUBLICO-DE-RENDER
RESEND_API_KEY=re_xxxx
RESEND_FROM_EMAIL=Agenda Docente <avisos@tu-dominio-verificado.com>
RESEND_REPLY_TO_EMAIL=tu-correo-de-soporte@gmail.com
```

`CORS_ORIGIN` acepta varios dominios separados por coma. La URL pública del backend
debe apuntar al mismo servicio de Render. En producción, usá dominios HTTPS y definí
explícitamente `MERCADO_PAGO_ENVIRONMENT` (`sandbox` o `production`).

- `npm test`: ejecuta las pruebas locales del backend.
- `GET /api/health`: comprueba que el proceso responde.
- `GET /api/health/ready`: comprueba Supabase, el esquema de notificaciones y la función transaccional de pagos.
- En Mercado Pago, configurá la URL `https://DOMINIO-PUBLICO-DE-RENDER/api/pagos/webhook` y copiá el secreto de firma a `MERCADO_PAGO_WEBHOOK_SECRET`.
- Para enviar email, verificá el dominio remitente en Resend y configurá `RESEND_API_KEY` y `RESEND_FROM_EMAIL` en Render. `RESEND_REPLY_TO_EMAIL` es opcional y recibe las respuestas de los docentes. Las notificaciones dentro de la agenda siguen funcionando sin esas credenciales.
- Ejecutá en Supabase SQL Editor [`schema/migrations/20261104_subscription_write_protection.sql`](./schema/migrations/20261104_subscription_write_protection.sql). La migración conserva la lectura durante la gracia, bloquea las escrituras directas, protege los planes y crea la tabla y función transaccional de notificaciones/pagos.
- Revisá [`INSTRUCCIONES_FRONTEND.md`](./INSTRUCCIONES_FRONTEND.md) antes de ajustar o volver a desplegar el frontend.

## 📌 Pendientes / Próximos Pasos

- [ ] Aplicar en Supabase la migración de protección de escrituras directas y verificar sus políticas.
- [ ] Configurar y probar en Render las variables de entorno con credenciales de prueba.
- [ ] Confirmar que `/api/health/ready` responde antes de conectar el frontend.
- [ ] Configurar y probar notificaciones firmadas de Mercado Pago en modo sandbox.
- [ ] Verificar el remitente de Resend y probar los emails VIP junto con las alertas dentro de la agenda.
- [ ] Implementar en el frontend el centro/indicador de notificaciones usando los endpoints documentados.
- [ ] Probar el ciclo de vencimiento completo con cuentas de prueba antes de invitar docentes.
- [ ] No habilitar pagos reales ni invitar docentes hasta completar las verificaciones anteriores.
