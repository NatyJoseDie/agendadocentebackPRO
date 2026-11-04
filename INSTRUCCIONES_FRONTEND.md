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

## 7. Alertas dentro de la agenda

Crear el indicador/centro de notificaciones en el frontend usando la API del backend:

- `GET /api/notificaciones?limite=20` devuelve `{ notificaciones, noLeidas }`. `limite`
  es opcional y acepta enteros de 1 a 50.
- `PATCH /api/notificaciones/:id/leida` marca como leída una notificación propia. Esta
  acción sigue permitida durante el período de solo lectura.
- Las notificaciones VIP se generan una sola vez para los hitos de fin del período
  VIP, 10 días antes de terminar la gracia y al finalizarla. Si el job se atrasó, se
  crea solamente el aviso más reciente para no inundar la cuenta.
- Los avisos en la aplicación no dependen de la configuración de email. Para el email,
  el backend usa Resend; `RESEND_API_KEY` y `RESEND_FROM_EMAIL` se configuran solo en
  Render, con un remitente verificado.

El frontend debe actualizar el indicador al iniciar sesión y al volver a la agenda,
mostrar los avisos no leídos y ofrecer una acción para marcarlos como leídos.

## 8. Comprobaciones antes de publicar

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

No se integrará WhatsApp en esta etapa. No se debe exponer ninguna credencial de
Resend ni de otro proveedor en el frontend.
