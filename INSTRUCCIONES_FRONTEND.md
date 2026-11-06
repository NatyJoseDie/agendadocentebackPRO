# Contrato del backend para el frontend

Esta guía documenta los nombres y contratos que están implementados en el backend.
El trabajo del frontend se realiza en su propio repositorio; no implica que esas
funciones ya estén conectadas en el frontend.

## 1. URL de producción y configuración

La URL pública confirmada del backend en Render es:

```env
VITE_API_URL=https://agendadocentebackpro.onrender.com/api
```

En Vercel, cargar `VITE_API_URL` en **Settings > Environment Variables** para los
entornos necesarios y volver a desplegar. La variable termina en `/api`: no agregar
otro `/api` al construir rutas.

Para desarrollo local:

```env
VITE_API_URL=http://localhost:3000/api
```

Render debe tener `CORS_ORIGIN` igual al origen exacto del frontend en Vercel, sin
`/api` ni barra final. Copiar el dominio real desde Vercel; no usar el ejemplo
literalmente. Varios orígenes se separan por comas. El `index.html` del frontend
local contiene `https://agendadocientepro.vercel.app` en metadatos Open Graph, pero
eso no confirma que sea el dominio desplegado; verificar la URL activa en Vercel
antes de cargar `CORS_ORIGIN`.

Comprobaciones del backend:

- `GET https://agendadocentebackpro.onrender.com/api/health` devuelve `status: "ok"`.
- `GET https://agendadocentebackpro.onrender.com/api/health/ready` devuelve
  `status: "ready"` si Supabase, pagos y notificaciones están disponibles.

El plan Free de Render puede tardar en responder cuando el servicio despierta.

## 2. Autenticación y errores comunes

Todas las rutas de negocio requieren una sesión vigente de Supabase, excepto health y
el webhook de Mercado Pago. Para las rutas del backend, enviar el `access_token` de
la sesión actual:

```js
const apiHeaders = {
  Authorization: `Bearer ${session.access_token}`,
}

const response = await fetch(`${import.meta.env.VITE_API_URL}/notificaciones?limite=20`, {
  headers: apiHeaders,
})
```

No enviar refresh tokens. Nunca poner `SUPABASE_SERVICE_ROLE_KEY`, claves privadas
VAPID, credenciales Mercado Pago, `RESEND_API_KEY` ni el secreto del webhook en el
frontend o en variables `VITE_*`.

- `401`: falta un `access_token` válido; actualizar la sesión o solicitar que inicie
  sesión nuevamente.
- `423` con `code: "READ_ONLY_GRACE_PERIOD"`: la cuenta está en el período de solo
  lectura; permitir consultas y mostrar el aviso de renovación.
- `404` en la URL raíz `/api` es normal: no hay una página de inicio de API.

## 3. Datos de agenda: Supabase directo y rutas del backend

El frontend existente realiza operaciones CRUD directamente contra Supabase. Para
esas operaciones usar el cliente del frontend con `SUPABASE_URL`, la clave publicable
(anon) y la sesión del usuario; nunca usar la clave `service_role`.

Los nombres que lee `src/supabaseClient.js` en el frontend son
`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Son distintos de los nombres sin
prefijo `VITE_` que usa el backend en Render. En el frontend se puede usar la clave
anon/publicable de Supabase, pero nunca `SUPABASE_SERVICE_ROLE_KEY`.

La migración `schema/migrations/20261104_subscription_write_protection.sql` ya se
aplicó en el proyecto de producción. No volver a ejecutarla para conectar el frontend.
Para que las cuentas nuevas reciban automáticamente su prueba PRO, ejecutar también
`schema/migrations/20261105_standard_trial_14_days.sql` en Supabase. Esta asigna
14 días a perfiles nuevos no VIP ni administrativos; no modifica cuentas existentes.
Al vencer, si no se activa un plan, se aplica solo lectura por 30 días y luego el
plan gratuito, conservando los datos. El pase VIP de los primeros 10 docentes sigue
siendo de 120 días.
Ejecutar también `schema/migrations/20261106_free_plan_resource_selection.sql`.
Si hay más de 1 escuela o 2 cursos activos al terminar la gracia, el frontend debe
permitir elegir una escuela y hasta dos cursos. La selección queda fija mientras la
cuenta siga en Free; los demás datos se conservan pero quedan bloqueados. Al activar
un plan pago, Supabase restablece el acceso completo. La selección se activa al pasar
de una suscripción PRO/Premium vencida a Free, no retroactivamente para cuentas Free
preexistentes.
`src/components/FreePlanSelectionGate.jsx` implementa este paso global después del
inicio de sesión y usa las RPC `obtener_opciones_plan_gratuito` y
`seleccionar_recursos_plan_gratuito`; no reemplazarlo por filtros solamente en la UI.

El backend también expone estos prefijos de ruta bajo `VITE_API_URL`; usarlos solo
cuando el frontend consuma la API en vez de Supabase directamente:

| Ruta | Uso |
|---|---|
| `/docentes/me` | Consultar, crear o actualizar el perfil propio |
| `/escuelas`, `/cursos`, `/alumnos` | CRUD de escuelas, cursos y alumnos |
| `/asistencias` | Asistencias y estadísticas |
| `/calificaciones`, `/planificaciones`, `/proyectos` | Datos pedagógicos |
| `/calendario` | Eventos de calendario del docente |
| `/horarios`, `/salidas`, `/contactos`, `/licencias`, `/libro-temas` | Funciones de agenda |
| `/necesidades` | Condiciones especiales de alumnos |
| `/notificaciones` | Avisos dentro de la aplicación |
| `/pagos` | Checkout y estado de suscripción |
| `/admin` | Administración; además restringida por `ADMIN_EMAILS` |
| `/ocr/process` | Procesamiento autenticado de imágenes |

Usar los nombres tal como aparecen: `/horarios` (no `/horarios_curso`),
`/calendario` (tabla `calendario`) y `/necesidades` (tabla
`condiciones_especiales`). La vista `v_calendario_maestro` no es una ruta del backend
ni una tabla editable. Las tablas fuente de eventos editables tienen sus propias
políticas RLS.

**Diferencia importante para el calendario actual:** el frontend local lee
`v_calendario_maestro` y crea eventos en las tablas `eventos_academicos` y `salidas`
directamente en Supabase. Los comentarios del frontend que dicen `POST /api/eventos`
no corresponden a una ruta existente del backend. Aunque sí existe `POST /api/salidas`,
esa ruta opera sobre `salidas_educativas`, no sobre la tabla `salidas` del calendario.
No conectar esos comentarios a la API sin acordar primero el contrato y el modelo de
datos; por ahora, las operaciones actuales deben seguir usando Supabase directo y RLS.

## 4. Pagos con Mercado Pago

`POST /api/pagos/crear-preferencia` requiere autenticación y JSON:

```json
{ "plan": "pro", "ciclo": "mensual" }
```

- `plan`: `pro` o `premium`.
- `ciclo`: `mensual` o `anual`.
- La respuesta exitosa contiene `id`, `init_point`, `checkout_url`,
  `sandbox_init_point`, `plan`, `ciclo` y `precio`. Redirigir al checkout indicado por
  `init_point` (o `checkout_url`); el backend elige la URL según su entorno.

Mercado Pago regresa al frontend en `/suscripcion` con `status=success`, `failure` o
`pending`. Son parámetros informativos del regreso, no prueba de pago. Al volver,
consultar `GET /api/pagos/estado` y refrescar el perfil. La confirmación real la
realiza el webhook firmado.

`POST /api/pagos/webhook` lo invoca Mercado Pago; no llamarlo desde el frontend. Para
pruebas, usar las credenciales y cuentas sandbox. No habilitar pagos reales hasta
validar el flujo y recibir autorización.

`GET /api/pagos/estado` devuelve:

```json
{
  "plan": "gratuito",
  "is_premium": false,
  "ultimoPago": null
}
```

`ultimoPago` puede ser un objeto con `mp_payment_id`, `monto`, `moneda`, `estado`,
`plan`, `fecha_pago` y `expira_at`, o `null` si todavía no hay pagos.

## 5. OCR

`POST /api/ocr/process` requiere autenticación y `multipart/form-data` con el campo
`image`. Adjuntar la imagen a `FormData`, obtener el `access_token` de la sesión de
Supabase y enviar el encabezado Bearer de la sección 2; no establecer `Content-Type`
manualmente, para que el navegador agregue el boundary. **La implementación OCR
actual en `src/services/api.js` del frontend todavía no envía ese token y usa una
URL fija de localhost; hay que corregir ambas cosas para producción.** Se aceptan JPG,
PNG y WebP de hasta 10 MB.

Respuesta exitosa:

```json
{ "alumnos": [{ "apellido": "PEREZ", "nombre": "ANA" }] }
```

Manejar `400` (no se adjuntó imagen), `401` (sesión), `413` (más de 10 MB), `415`
(tipo no aceptado) y `503` (OCR no configurado).

## 6. Panel de administración

Ambas rutas requieren autenticación; además el backend compara el correo de la sesión
con `ADMIN_EMAILS` configurado en Render:

- `GET /api/admin/metricas`
- `POST /api/admin/modificar-docente` con `docente_id` y `nuevo_plan`
  (`gratuito`, `free`, `pro` o `premium`), `dias_extra` (entero de 1 a 3650), o ambos.

`nuevo_plan: "free"` se normaliza a `"gratuito"`. Un usuario que no sea administrador
recibe `403`; ocultar controles en la interfaz no reemplaza esta validación del
backend.

## 7. Centro de notificaciones (API existente)

Las rutas de notificaciones requieren la sesión Bearer indicada en la sección 2.

`GET /api/notificaciones?limite=20` devuelve:

```json
{
  "notificaciones": [
    {
      "id": "uuid",
      "tipo": "vip_trial_ended",
      "titulo": "Tu período VIP terminó",
      "mensaje": "El período VIP terminó.",
      "programada_para": "2026-11-04T12:00:00.000Z",
      "leida_at": null,
      "created_at": "2026-11-04T12:00:00.000Z"
    }
  ],
  "noLeidas": 1
}
```

`limite` es opcional, por defecto 20, y acepta enteros de 1 a 50. El listado se ordena
por `created_at` descendente. `PATCH /api/notificaciones/:id/leida` marca como leída
una notificación propia y devuelve
`{"notificacion":{"id":"uuid","leida_at":"..."}}`. Devuelve `404` si no existe o no
pertenece al usuario. Marcar como leída sigue permitido en solo lectura.

Al iniciar sesión y volver a la agenda, consultar el listado y el contador `noLeidas`.
Al marcar una notificación, actualizar el listado/contador con la respuesta o volver a
consultar el endpoint. No leer ni actualizar la tabla `notificaciones_docente`
directamente desde el frontend.

### Interfaz requerida

- Agregar una campanita visible en la navegación principal de la app autenticada.
- Mostrar junto a la campana un badge con `noLeidas` cuando el valor sea mayor que 0;
  ocultarlo cuando no haya notificaciones sin leer.
- Al tocar la campana, abrir un panel o pantalla con el listado obtenido desde la API.
- Al tocar una notificación no leída, marcarla con
  `PATCH /api/notificaciones/:id/leida` y actualizar su estado visual y el badge.
- Mostrar estados de carga, error y lista vacía. La campana informa avisos dentro de la
  app cuando la docente la abre; no es una notificación push del sistema operativo.

El backend genera avisos VIP una vez para el fin del período VIP, 10 días antes de
terminar la gracia y al finalizarla. Si el job se atrasó, genera solo el aviso más
reciente. Actualmente son notificaciones dentro de la aplicación; el centro visual de
notificaciones debe implementarse en el frontend.

## 8. PWA y notificaciones push (aún no implementadas)

El backend actual no tiene rutas de suscripción de dispositivos ni servicio de envío
push. No intentar llamar endpoints push hasta que se agreguen, documenten y desplieguen
en el backend.

### Trabajo requerido en el frontend

1. El frontend ya tiene `public/manifest.json`, enlazado desde `index.html`, y
   `public/sw.js`. Mantener esos nombres/ubicaciones o actualizar coherentemente las
   referencias; no crear un segundo manifest con otra ruta. Revisar `start_url`,
   `scope`, iconos y modo `standalone`. El registro del service worker en `src/main.jsx`
   está comentado actualmente: activarlo solo después de revisar la estrategia de
   caché y probarlo en HTTPS.
2. Agregar una acción explícita **“Activar notificaciones”**. Pedir permiso solo
   después de que la persona la elija. Comprobar soporte con
   `('serviceWorker' in navigator)` y `('PushManager' in window)`; permiso denegado o
   falta de soporte no debe impedir el uso de la agenda.
3. Al aceptar, registrar el service worker y crear la suscripción con la clave pública
   VAPID que entregue el backend. Enviar el objeto completo `PushSubscription` a la
   futura ruta de registro. La clave privada VAPID solo debe existir como secreto en
   Render, nunca en el frontend ni en `VITE_*`.
4. Al cerrar sesión o desactivar push, desuscribir ese dispositivo y avisar a la
   futura ruta de baja. Permitir varios dispositivos por usuario y no eliminar
   suscripciones de otras cuentas.
5. En el service worker, manejar `push` y `notificationclick`; al tocar el aviso,
   abrir la agenda y navegar al centro de notificaciones. Validar que la URL destino
   sea del mismo origen de la aplicación.
6. No cachear respuestas autenticadas, datos de alumnos ni notificaciones en el
   almacenamiento offline del service worker. Si se agrega modo offline, limitar el
   caché a recursos estáticos públicos y definir cómo limpiarlo al cerrar sesión.
7. El `public/sw.js` actual solo maneja caché; no implementa los eventos `push` ni
   `notificationclick`. En iPhone/iPad, informar que la persona debe agregar la web a
   la pantalla de inicio y abrir la PWA instalada antes de activar push. Probar
   soporte y permisos en iOS, Android y escritorio; no prometer push si el navegador
   no lo admite.

### Contrato pendiente del backend para push

- Definir las rutas exactas para registrar/eliminar una `PushSubscription`. Deben
  autenticar al usuario, validar endpoint y claves, vincular el registro a
  `req.user.id` (no confiar en un ID enviado por el cliente) y limitar bajas a los
  dispositivos de esa cuenta.
- Guardar las suscripciones de manera persistente y enviar un push cuando se cree una
  notificación VIP. El payload no debe incluir datos personales sensibles; la bandeja
  del backend continúa siendo la fuente de verdad.
- Configurar clave privada, clave pública y contacto VAPID según el diseño acordado.
  La clave privada y cualquier secreto deben guardarse solo en Render; la clave
  pública podrá entregarse al frontend mediante el contrato acordado.
- Definir caducidad, reintentos, borrado de suscripciones vencidas y respuestas de
  error. Probar aislamiento con distintas cuentas y dispositivos.

## 9. Email y publicación

El backend tiene integración opcional con Resend, pero el email no queda habilitado
hasta configurar en Render `RESEND_API_KEY` y `RESEND_FROM_EMAIL` con un remitente
permitido/verificado por el proveedor. `RESEND_REPLY_TO_EMAIL` es opcional y recibe
las respuestas. No exponer esas variables en el frontend. Las notificaciones dentro
de la app no dependen de email. Actualmente estas variables de Resend no están
configuradas en producción; no presentar los emails como activos.

### Cambios concretos de conexión pendientes en el frontend local

- En `src/services/api.js`, reemplazar `const BACKEND_URL = 'http://localhost:3000/api'`
  por `const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'`.
  Mantener las rutas relativas documentadas arriba, por ejemplo
  `` `${BACKEND_URL}/pagos/estado` ``.
- En `OCRAPI.processImage`, obtener la sesión de Supabase y enviar su `access_token`
  como `Authorization: Bearer ...`; sin eso el backend responde `401`.
- Las llamadas de pagos y administración del frontend ya envían un token cuando hay
  sesión, pero deben usar `BACKEND_URL` configurable y verificar que no sea `null`.
- En `src/main.jsx`, el registro del service worker está comentado. No hay push todavía;
  primero implementar la bandeja dentro de la app con `/notificaciones`.

Antes de publicar:

1. Confirmar que `/api/health` y `/api/health/ready` responden correctamente.
2. Revisar en la pestaña Network que las llamadas vayan a
   `https://agendadocentebackpro.onrender.com/api` en producción, nunca a
   `localhost`, y que no haya errores CORS.
3. Probar inicio de sesión, carga de perfil y funciones de agenda con una cuenta de
   prueba.
4. Probar el centro de notificaciones: listado, contador, marcado como leído y
   aislamiento entre cuentas.
5. Probar checkout y webhook con cuentas sandbox; verificar que una notificación
   repetida no extienda nuevamente la suscripción.
6. Probar el período de solo lectura y confirmar que se mantiene la consulta de datos
   pero se rechazan escrituras, tanto por la API como por Supabase directo.
7. Probar instalación, permisos, recepción push con la app cerrada, navegación al
   tocar el aviso y baja de suscripción solo después de desplegar también el backend
   push.

WhatsApp no se integra en esta etapa.
