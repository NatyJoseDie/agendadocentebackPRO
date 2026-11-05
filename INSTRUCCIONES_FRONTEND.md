# Indicaciones para conectar el frontend

Este archivo acompaña el trabajo del backend. Los cambios de frontend se harán en su
carpeta y repositorio por separado; esta guía no los aplica automáticamente.

## 1. URL del backend

En el frontend, reemplazar la URL fija `http://localhost:3000/api` por la variable
de Vite `VITE_API_URL`, conservando ese valor como alternativa para desarrollo local:

```env
# Desarrollo local
VITE_API_URL=http://localhost:3000/api
```

En Vercel, cargar `VITE_API_URL` con la URL pública HTTPS del servicio Render y el
sufijo `/api` (por ejemplo, `https://<servicio>.onrender.com/api`). Luego reconstruir
y desplegar el frontend. La URL concreta debe copiarse del servicio real de Render;
no adivinarla ni dejar `localhost` en producción.

Configurar también en Render `CORS_ORIGIN` con el dominio exacto de Vercel. Si se
usan varios dominios (producción y preview), separarlos con comas.

## 2. Autenticación

Las rutas de pagos, administración y OCR requieren una sesión vigente de Supabase.
Enviar el token del usuario en el encabezado:

```http
Authorization: Bearer <session.access_token>
```

No enviar `SUPABASE_SERVICE_ROLE_KEY`, el token de Mercado Pago ni el secreto del
webhook desde el navegador.

## 3. Pagos

- `POST /api/pagos/crear-preferencia` recibe `{ "plan": "pro" | "premium", "ciclo": "mensual" | "anual" }`.
- Resuelve el pago con `data.init_point` (o `data.checkout_url`). El backend devuelve
  en esa propiedad el checkout correcto para `MERCADO_PAGO_ENVIRONMENT`.
- En modo `sandbox`, usar credenciales y cuentas de prueba de Mercado Pago. No probar
  con dinero real hasta completar la validación del webhook y recibir autorización.
- El backend recibe la notificación en `/api/pagos/webhook`; no llamar ese endpoint
  desde el frontend ni considerar la URL de retorno de checkout como confirmación de
  pago.
- Al volver del checkout, consultar `GET /api/pagos/estado` y refrescar el perfil.
  La activación efectiva la confirma el webhook firmado, no el parámetro `status` de
  la URL del navegador.

## 4. OCR

`POST /api/ocr/process` requiere autenticación y recibe `multipart/form-data` con el
campo `image`. Enviar `Authorization: Bearer ...`, sin definir manualmente el
`Content-Type` para que el navegador agregue el boundary. Se aceptan imágenes JPG,
PNG o WebP de hasta 10 MB.

## 5. Panel de administración

Usar las rutas existentes con el token del usuario:

- `GET /api/admin/metricas`
- `POST /api/admin/modificar-docente` con `docente_id` y `nuevo_plan` (`gratuito`,
  `free`, `pro` o `premium`), `dias_extra` (entero de 1 a 3650), o ambos.

El backend verifica los correos autorizados mediante `ADMIN_EMAILS` en Render. Un
usuario no autorizado debe recibir `403`; no habilitar controles administrativos
solo con una comprobación del lado del cliente.

## 6. Suscripciones y Supabase

La aplicación realiza operaciones CRUD directamente contra Supabase. Antes de probar
el modo de solo lectura, ejecutar en Supabase SQL Editor la migración
[`schema/migrations/20261104_subscription_write_protection.sql`](./schema/migrations/20261104_subscription_write_protection.sql).
Sin esa migración, las escrituras directas del navegador no pasan por el middleware
del backend y el período de gracia no queda protegido.

La migración mantiene la lectura durante la gracia, restringe escrituras y evita que
un usuario cambie su propio plan. Verificar los casos de cuenta vigente, vencida
dentro de la gracia y vencida hace más de 30 días.

## 7. Centro de notificaciones (API existente)

El backend ya expone estas rutas autenticadas. Todas las solicitudes deben usar
`Authorization: Bearer <access_token_de_supabase>`:

- `GET /api/notificaciones?limite=20` devuelve:

  ```json
  {
    "notificaciones": [
      {
        "id": "uuid",
        "tipo": "vip_trial_ended",
        "titulo": "Tu período VIP terminó",
        "mensaje": "…",
        "programada_para": "2026-11-04T12:00:00.000Z",
        "leida_at": null,
        "created_at": "2026-11-04T12:00:00.000Z"
      }
    ],
    "noLeidas": 1
  }
  ```

- `limite` es opcional (por defecto 20; entero entre 1 y 50). El endpoint devuelve
  primero las más recientes.
- `PATCH /api/notificaciones/:id/leida` marca una notificación propia como leída y
  devuelve `{ "notificacion": { "id": "uuid", "leida_at": "…" } }`. La acción sigue
  permitida durante el período de solo lectura. Manejar `404` si no existe o no
  pertenece al usuario y `401` si falta una sesión válida.
- Cargar/actualizar el contador al iniciar sesión y al volver a la agenda; refrescarlo
  después de marcar una notificación como leída. No consultar Supabase directamente
  para leer ni modificar esta tabla: usar la API del backend.
- Los avisos VIP se generan una sola vez para el fin del período VIP, 10 días antes
  de terminar la gracia y al finalizarla. Si el job se atrasó, el backend crea solo
  el aviso más reciente para no inundar la cuenta.

## 8. PWA instalable y notificaciones push (trabajo coordinado, aún no implementado)

La API actual **no tiene** servicio worker, suscripciones push, rutas de registro de
dispositivo ni envío push. No intentar llamar endpoints push antes de que el backend
los implemente y despliegue. Primero completar el centro de notificaciones de la
sección anterior; luego coordinar esta integración entre repositorios.

### Trabajo requerido en el frontend

1. Preparar la agenda como PWA: `manifest.webmanifest` con nombre, nombre corto,
   colores, `start_url`, `scope`, modo `standalone` e iconos apropiados; registrar un
   service worker desde una ruta del mismo origen (por ejemplo `/sw.js`). Servir todo
   por HTTPS en producción.
2. Agregar una opción clara **“Activar notificaciones”**. Pedir permiso solo después
   de que el usuario la elija, no al cargar la página. Comprobar soporte con
   `('serviceWorker' in navigator)` y `('PushManager' in window)`; tratar permiso
   denegado o navegador no compatible sin bloquear el uso de la agenda.
3. Al aceptar, registrar el service worker, crear una suscripción usando la clave
   pública VAPID que entregue el backend y enviar el objeto completo de
   `PushSubscription` al endpoint de registro que se acuerde. No guardar claves
   privadas en el frontend ni en variables `VITE_*`.
4. Al cerrar sesión o desactivar las notificaciones, desuscribir el dispositivo y
   avisar al endpoint de baja del backend acordado. Cada usuario puede tener varios
   dispositivos; no borrar suscripciones de otros usuarios.
5. En el service worker, manejar el evento `push` y mostrar el título y cuerpo
   recibidos. Manejar `notificationclick` para abrir la agenda y navegar a la bandeja
   de notificaciones; validar que cualquier URL recibida sea del origen de la app.
6. No cachear respuestas autenticadas, datos de alumnos ni notificaciones en el
   almacenamiento offline del service worker. Si se implementa modo offline, limitar
   el caché a recursos estáticos públicos y definir una estrategia segura para
   limpiarlo al cerrar sesión.
7. En iPhone/iPad, explicar al usuario que debe agregar la web a la pantalla de
   inicio y abrir la PWA instalada antes de activar push. Probar también el flujo de
   instalación y permisos en Android y escritorio; no prometer push si el navegador
   no lo soporta.

### Contrato que debe acordarse con el backend antes de conectar push

- Solicitar al backend las rutas exactas para registrar y eliminar una
  `PushSubscription`; las rutas aún no existen. Deben exigir la sesión del usuario,
  validar el endpoint y las claves recibidas, asociar el dispositivo al usuario
  autenticado y permitir que solo ese usuario elimine su suscripción.
- El backend debe guardar suscripciones de manera persistente y enviar un push cuando
  cree una notificación VIP. La clave privada VAPID y el identificador de contacto
  VAPID deben vivir exclusivamente como variables secretas en Render.
- Al recibir un push, el frontend puede refrescar la bandeja con
  `GET /api/notificaciones`; el payload push no debe ser la fuente de verdad ni
  incluir datos personales sensibles. La lectura y el marcado como leído siguen
  usando las rutas API existentes.
- Acordar expiración, reintentos, borrado de suscripciones vencidas y respuestas de
  error antes del despliegue. Probar con dos cuentas y varios dispositivos para
  verificar que un usuario nunca reciba avisos de otro.

Los avisos dentro de la app no dependen de email ni de push. El backend tiene
integración opcional con Resend: `RESEND_API_KEY` y `RESEND_FROM_EMAIL` se configuran
solo en Render con un remitente verificado. `RESEND_REPLY_TO_EMAIL` puede apuntar al
buzón de soporte.

## 9. Comprobaciones antes de publicar

1. Abrir `GET <URL-RENDER>/api/health` y comprobar `status: "ok"`.
2. Abrir `GET <URL-RENDER>/api/health/ready` y comprobar `status: "ready"`.
3. En el navegador publicado, comprobar que ninguna solicitud de API va a
   `localhost` y que no hay errores de CORS.
4. Probar registro/inicio de sesión y las funciones de agenda con una cuenta de
   prueba.
5. Probar creación de preferencia y webhook firmado con cuentas sandbox; verificar
   que una notificación repetida no extienda nuevamente la suscripción.
6. Confirmar que las escrituras quedan bloqueadas durante la gracia también en
   Supabase directo, sin perder acceso de lectura.
7. Para PWA/push, probar instalación, permisos, recepción con la app cerrada,
   navegación al tocar el aviso, baja de suscripción y aislamiento entre cuentas en
   Android, iOS/iPadOS y escritorio, solo después de desplegar también el backend push.

No se integrará WhatsApp en esta etapa. No se debe exponer ninguna credencial de
Resend ni de otro proveedor en el frontend.
