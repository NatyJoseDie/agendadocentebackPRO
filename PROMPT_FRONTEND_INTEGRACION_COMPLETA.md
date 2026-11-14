# PROMPT COMPLETO PARA FRONTEND — Integración Planes, Precios, OCR y Admin

## 📋 RESUMEN DE CAMBIOS BACKEND (ya desplegados / listos para consumir)

### 1. NUEVOS ENDPOINTS PÚBLICOS
```
GET /api/pagos/planes
```
**Respuesta:**
```json
{
  "planes": [
    {
      "id": "pro_mensual",
      "plan": "pro",
      "ciclo": "mensual",
      "titulo": "Agenda Docente - Plan PRO (Mensual)",
      "precio": 4500,
      "precio_promocional": 3500,
      "promo_hasta": "2027-04-29T23:59:59-03:00",
      "activo": true,
      "en_promocion": true,
      "precio_vigente": 3500
    },
    {
      "id": "pro_ciclo_lectivo",
      "plan": "pro",
      "ciclo": "ciclo_lectivo",
      "titulo": "Agenda Docente - Plan PRO (Ciclo lectivo)",
      "precio": 36000,
      "precio_promocional": 15000,
      "promo_hasta": "2027-04-29T23:59:59-03:00",
      "activo": true,
      "en_promocion": true,
      "precio_vigente": 15000
    },
    {
      "id": "premium_mensual",
      "plan": "premium",
      "ciclo": "mensual",
      "titulo": "Agenda Docente - Plan PREMIUM (Mensual)",
      "precio": 5500,
      "precio_promocional": 5000,
      "promo_hasta": "2027-04-29T23:59:59-03:00",
      "activo": true,
      "en_promocion": true,
      "precio_vigente": 5000
    },
    {
      "id": "premium_ciclo_lectivo",
      "plan": "premium",
      "ciclo": "ciclo_lectivo",
      "titulo": "Agenda Docente - Plan PREMIUM (Ciclo lectivo)",
      "precio": 44000,
      "precio_promocional": 24000,
      "promo_hasta": "2027-04-29T23:59:59-03:00",
      "activo": true,
      "en_promocion": true,
      "precio_vigente": 24000
    },
    {
      "id": "basico_mensual",
      "plan": "basico",
      "ciclo": "mensual",
      "titulo": "Agenda Docente - Plan BÁSICO (Mensual)",
      "precio": 1500,
      "precio_promocional": 1200,
      "promo_hasta": "2027-04-29T23:59:59-03:00",
      "activo": true,
      "en_promocion": true,
      "precio_vigente": 1200
    },
    {
      "id": "basico_ciclo_lectivo",
      "plan": "basico",
      "ciclo": "ciclo_lectivo",
      "titulo": "Agenda Docente - Plan BÁSICO (Ciclo lectivo)",
      "precio": 12000,
      "precio_promocional": 9000,
      "promo_hasta": "2027-04-29T23:59:59-03:00",
      "activo": true,
      "en_promocion": true,
      "precio_vigente": 9000
    }
  ]
}
```

**Campos clave para UI:**
- `precio_vigente` → **mostrar este precio** (ya aplica promo si vigente)
- `en_promocion: true` → mostrar `precio` tachado + badge "Promo hasta {promo_hasta formateada es-AR}"
- `activo: false` → no mostrar (plan desactivado por admin)

---

### 2. ENDPOINT DE PAGO ACTUALIZADO
```
POST /api/pagos/crear-preferencia
Headers: Authorization: Bearer <access_token>
Body: { "plan": "pro"|"premium"|"basico", "ciclo": "mensual"|"ciclo_lectivo" }
```

**Respuesta exitosa:**
```json
{
  "id": "mp_preference_id",
  "init_point": "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=...",
  "checkout_url": "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=...",
  "sandbox_init_point": "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=...",
  "plan": "pro",
  "ciclo": "ciclo_lectivo",
  "precio": 15000,
  "en_promocion": true
}
```

**Notas importantes:**
- `ciclo_lectivo`: **vence 31/12**. Si se paga **oct-dic** → cubre hasta **31/12 del año siguiente**.
- Frontend debe explicar esto debajo del botón: *"El ciclo lectivo va de febrero a diciembre. Si pagás entre octubre y diciembre, tu suscripción cubre hasta el 31/12 del año próximo."*
- El backend guarda en `intenciones_pago` para auditoría.

---

### 3. OCR — NUEVAS VALIDACIONES Y ERRORES
```
POST /api/ocr/process
Headers: Authorization: Bearer <access_token>
Content-Type: multipart/form-data
FormData: image (file) + curso_id (UUID string)
```

**Errores específicos (todos devuelven `{ error: { code, message } }`):**

| Código | HTTP | Cuándo | Mensaje (listo para mostrar) |
|--------|------|--------|------------------------------|
| `OCR_CURSO_REQUIRED` | 400 | Falta `curso_id` o no es UUID | "Se requiere el ID del curso (curso_id)." |
| `OCR_CURSO_NO_ENCONTRADO` | 404 | Curso no existe o no pertenece al docente | "Curso no encontrado." |
| `OCR_PLAN_REQUIRED` | 403 | Plan Gratuito, vencido, o sin trial vigente | "El OCR requiere Plan PRO, BÁSICO o Premium. Tu plan actual no lo incluye." |
| `OCR_CURSOS_LIMIT` | 403 | Plan PRO ya usó OCR en 5 cursos distintos y este es nuevo | "El Plan PRO permite OCR en hasta 5 cursos distintos. Ya usaste tu límite." |

**Éxito:** `{ "alumnos": [{ "apellido": "...", "nombre": "..." }] }`

**Implementación frontend:**
```js
// En CursoDashboard.jsx al llamar OCR
const formData = new FormData();
formData.append('image', file);
formData.append('curso_id', cursoId); // UUID del curso actual

const res = await fetch(`${API_URL}/ocr/process`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${session.access_token}` },
  body: formData,
});

if (!res.ok) {
  const { error } = await res.json();
  if (error?.code === 'OCR_PLAN_REQUIRED' || error?.code === 'OCR_CURSOS_LIMIT') {
    // Mostrar error.message + botón "Ver planes" → /suscripcion
  }
  if (error?.code === 'OCR_CURSO_REQUIRED') {
    // Error de programación: curso_id no enviado
  }
  if (error?.code === 'OCR_CURSO_NO_ENCONTRADO') {
    // Curso borrado o sin permisos
  }
  throw new Error(error?.message || 'Error en OCR');
}
```

---

### 4. LÍMITES POR PLAN (para validaciones en UI y mostrar en tarjetas)

| Plan | Escuelas | Cursos | OCR | Backups |
|------|----------|--------|-----|---------|
| **Gratuito** | 1 | 2 | ❌ | ✅ |
| **BÁSICO** | 3 | 5 | ❌ | ✅ |
| **PRO** | 6 | 10 | ✅ (hasta 5 cursos distintos) | ✅ |
| **Premium** | ∞ | ∞ | ✅ (ilimitado) | ✅ |

**VIP Beta** (`is_vip_beta=true` o `is_premium=true` con trial > 120 días) = **Premium** (sin límites).

**En frontend (`src/constants/plans.js`):**
```js
export const PLAN_LIMITS = {
  gratuito: { escuelas: 1, cursos: 2, ocrCursos: 0, ocr: false },
  basico:   { escuelas: 3, cursos: 5, ocrCursos: 0, ocr: false },
  pro:      { escuelas: 6, cursos: 10, ocrCursos: 5, ocr: true },
  premium:  { escuelas: null, cursos: null, ocrCursos: null, ocr: true },
};

export function getPlanLimits(plan, subscriptionPlan, isVipBeta) {
  if (isVipBeta) return PLAN_LIMITS.premium;
  const p = (plan || subscriptionPlan || 'gratuito').toLowerCase();
  return PLAN_LIMITS[p] || PLAN_LIMITS.gratuito;
}
```

**Usar `docente.plan` / `docente.subscription_plan`** (NO `is_premium` porque el backend pone `is_premium=true` tanto en PRO como en Premium).

---

### 5. ERRORES 42501 EN ALTAS (escuelas/cursos)
Cuando Supabase devuelve error **42501** en `POST /escuelas` o `POST /cursos` (RLS/trigger), el mensaje ya viene listo:

```json
{ "error": "El Plan BÁSICO permite hasta 3 escuelas." }
{ "error": "El Plan PRO permite hasta 10 cursos." }
{ "error": "El Plan Gratuito permite hasta 1 escuela." }
{ "error": "Elegí los recursos del Plan Gratuito antes de crear nuevos." }
```

**Frontend:** catch 42501 → mostrar `error.message` + botón "Ver planes" → `/suscripcion`.

---

### 6. PANEL ADMIN — PRECIOS (`/admin/precios`)

#### GET `/api/admin/precios` (auth + admin)
```json
{
  "planes": [
    // mismos 6 planes que GET /pagos/planes + updated_at, updated_by
  ],
  "recordatorio": {
    "ultimo_ajuste_at": "2026-11-01T00:00:00.000Z",
    "proximo_ajuste_at": "2027-05-01T00:00:00.000Z",
    "meses_recordatorio": 6,
    "ajuste_pendiente": false
  }
}
```

#### PUT `/api/admin/precios` (auth + admin)
**Body:**
```json
{
  "planes": [
    { "id": "pro_mensual", "precio": 5000, "precio_promocional": 4000, "promo_hasta": "2027-06-30T23:59:59-03:00", "activo": true },
    { "id": "pro_ciclo_lectivo", "precio": 40000, "precio_promocional": null, "promo_hasta": null, "activo": true },
    ...
  ],
  "meses_recordatorio": 6
}
```

**Reglas de validación (backend devuelve 400 con `{ error }`):**
- `precio`, `precio_promocional`: **número > 0** (no string)
- `precio_promocional`, `promo_hasta`: pueden ser `null` (saca promo)
- `promo_hasta`: ISO 8601 string
- `activo`: boolean
- `meses_recordatorio`: entero 1–24

**UI sugerida (AdminDashboard.jsx):**
- Tabla editable: columnas = Plan, Ciclo, Precio normal, Precio promo, Fin promo (date picker), Activo (checkbox)
- Botón "Guardar" → PUT
- Alerta destacada arriba si `recordatorio.ajuste_pendiente: true`:
  > ⚠️ **Pasaron 6 meses desde el último ajuste de precios** (último: 01/11/2026, próximo: 01/05/2027). Revisá si corresponde actualizar.
- Input numérico para `meses_recordatorio` (1–24)

---

### 7. NOTIFICACIONES — NUEVO TIPO `ajuste_precios`
El centro de notificaciones (`GET /api/notificaciones`) ahora también devuelve notificaciones de tipo `ajuste_precios` (tabla `notificaciones_docente`). No requiere cambios en el consumo, solo que la UI no filtre por tipo hardcodeado.

---

### 8. SUSCRIPCIÓN — PANTALLA `/suscripcion` (Suscripcion.jsx)

**Cargar planes dinámicamente:**
```js
const { planes } = await PlanesAPI.getPlanes(); // GET /api/pagos/planes
const planesActivos = planes.filter(p => p.activo);
```

**UI:**
- Dos columnas/tabs: **Mensual** / **Ciclo lectivo**
- Cada plan (BÁSICO, PRO, Premium) muestra `precio_vigente`
- Si `en_promocion`: precio tachado + "Promo hasta {formatear(promo_hasta, 'es-AR')}"
- Debajo de Ciclo lectivo: texto explicativo del vencimiento 31/12 (ver sección 2)
- Botón "Contratar" → `POST /api/pagos/crear-preferencia` con `{ plan, ciclo }`

---

### 9. LANDING — TARJETAS DE PRECIOS (Landing.jsx)

**Cargar con `PlanesAPI.getPlanes()`** (público, sin auth).
**Tarjetas:** Gratuito / BÁSICO / PRO / Premium (4 columnas)
- **Gratuito:** 1 escuela, 2 cursos, sin OCR, backups ✅ — "Gratis para siempre"
- **BÁSICO:** 3 escuelas, 5 cursos, sin OCR, backups ✅ — precio_vigente mensual/ciclo
- **PRO:** 6 escuelas, 10 cursos, OCR 5 cursos, backups ✅ — precio_vigente mensual/ciclo
- **Premium:** Ilimitado todo, backups ✅, soporte prioritario — precio_vigente mensual/ciclo

**Corregir tarjeta Gratuita:** NO dice "30 días / 5 escuelas" → dice "1 escuela, 2 cursos, gratis para siempre".
**Corregir tarjeta PRO:** NO muestra precios de Premium → usa sus propios `precio_vigente`.

---

### 10. DASHBOARD — BANNER SOLO LECTURA + MENÚ

**Banner de solo lectura (cuando `423 READ_ONLY_GRACE_PERIOD`):**
- Usar `precio_vigente` de `pro_mensual` desde `PlanesAPI.getPlanes()` (no hardcodeado)
- Botón "Renovar ahora" → `/suscripcion`

**Menú de usuario (ruedita/avatar):**
- Ítem **"💳 Planes / Mi suscripción"** → `/suscripcion` (siempre visible)
- Badge del plan **fuera del avatar** (ej. "PRO", "BÁSICO", "Premium", "Gratuito")
- Menú desplegable: **limitar al viewport** (`maxHeight: '80vh'`, `overflowY: 'auto'`, recalcular en `resize`/`scroll`)

---

### 11. CONSTANTES FRONTEND ACTUALIZADAS (`src/constants/plans.js`)

```js
export const PLAN_LIMITS = {
  gratuito: { escuelas: 1, cursos: 2, ocrCursos: 0, ocr: false, nombre: 'Gratuito' },
  basico:   { escuelas: 3, cursos: 5, ocrCursos: 0, ocr: false, nombre: 'BÁSICO' },
  pro:      { escuelas: 6, cursos: 10, ocrCursos: 5, ocr: true, nombre: 'PRO' },
  premium:  { escuelas: null, cursos: null, ocrCursos: null, ocr: true, nombre: 'Premium' },
};

export const PLAN_CICLOS = ['mensual', 'ciclo_lectivo'];

export function getPlanLimits(plan, subscriptionPlan, isVipBeta) {
  if (isVipBeta) return PLAN_LIMITS.premium;
  const p = (plan || subscriptionPlan || 'gratuito').toLowerCase();
  return PLAN_LIMITS[p] || PLAN_LIMITS.gratuito;
}

export function canCreateEscuela(limits, currentEscuelas) {
  if (limits.escuelas === null) return true;
  return currentEscuelas < limits.escuelas;
}

export function canCreateCurso(limits, currentCursos) {
  if (limits.cursos === null) return true;
  return currentCursos < limits.cursos;
}

export function canUseOcrInCurso(limits, cursosConOcrUsados, cursoId) {
  if (!limits.ocr) return false;
  if (limits.ocrCursos === null) return true;
  if (cursosConOcrUsados.has(cursoId)) return true;
  return cursosConOcrUsados.size < limits.ocrCursos;
}
```

---

### 12. SERVICIO API (`src/services/api.js`)

```js
// Agregar a PlanesAPI
export const PlanesAPI = {
  async getPlanes() {
    const res = await fetch(`${API_URL}/pagos/planes`);
    if (!res.ok) throw new Error('Error cargando planes');
    return res.json(); // { planes: [...] }
  },
};

// Agregar a AdminAPI
export const AdminAPI = {
  async getPrecios() {
    const res = await fetch(`${API_URL}/admin/precios`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Error cargando precios');
    return res.json(); // { planes: [...], recordatorio: {...} }
  },

  async updatePrecios(payload) {
    const res = await fetch(`${API_URL}/admin/precios`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error || 'Error actualizando precios');
    }
    return res.json(); // { success, planes, recordatorio }
  },
};

// Actualizar OCRAPI
export const OCRAPI = {
  async processImage(file, cursoId) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('curso_id', cursoId);

    const res = await fetch(`${API_URL}/ocr/process`, {
      method: 'POST',
      headers: authHeaders(), // NO setear Content-Type manualmente
      body: formData,
    });

    if (!res.ok) {
      const { error } = await res.json();
      throw { code: error?.code, message: error?.message, status: res.status };
    }
    return res.json(); // { alumnos: [...] }
  },
};
```

---

### 13. CHECKLIST DE PRUEBAS FRONTEND

- [ ] `GET /pagos/planes` carga 6 planes, muestra `precio_vigente`, promo tachada, formatea `promo_hasta` es-AR
- [ ] Landing: 4 tarjetas (Gratuito, BÁSICO, PRO, Premium) con límites y precios correctos
- [ ] `/suscripcion`: tabs Mensual/Ciclo lectivo, botones envían `ciclo: 'ciclo_lectivo'`, texto explicativo visible
- [ ] OCR: envía `curso_id`, maneja 4 códigos de error con botones a `/suscripcion`
- [ ] Altas escuela/curso: catch 42501 muestra mensaje + botón a `/suscripcion`
- [ ] Admin `/admin/precios`: tabla editable 6 filas, guardar hace PUT, alerta `ajuste_pendiente` visible
- [ ] Dashboard: banner solo lectura usa precio PRO mensual dinámico, menú tiene "Planes / Mi suscripción", badge plan fuera del avatar, menú no se corta
- [ ] Notificaciones: lista incluye tipo `ajuste_precios` sin romper
- [ ] `npm run lint` y `npm run build` pasan sin errores

---

### 14. VARIABLES DE ENTORNO FRONTEND (Vercel)
```env
VITE_API_URL=https://agendadocentebackpro.onrender.com/api
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```
**Recordar:** `VITE_API_URL` **ya incluye `/api`**. No agregar otro `/api` al construir rutas.

---

### 15. MIGRACIÓN SQL PENDIENTE EN SUPABASE
Ejecutar en Supabase SQL Editor:
```sql
-- Archivo: schema/migrations/20261112_add_basico_plan.sql
-- (Ya generado en el repo backend)
```
Esto crea los 2 planes Básico y actualiza el trigger de límites.

---

¿Dudas? Cualquier endpoint devuelve `{ error: "mensaje listo para mostrar" }` en errores 4xx/5xx. Usar ese mensaje directamente en toast/alert.