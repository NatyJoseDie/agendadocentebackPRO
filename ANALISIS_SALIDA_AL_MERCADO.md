# Diagnóstico y Análisis: Requisitos para Sacar "Agenda Docente" al Mercado

Para transformar este proyecto de un **prototipo funcional en desarrollo** a un **producto comercializable (SaaS)** listo para vender a docentes, se deben cubrir 6 áreas clave:

---

### 1. Inconsistencias Técnicas Inmediatas (Backend y Base de Datos)

Revisando el código y la base de datos, hay detalles críticos que deben alinearse antes de cualquier despliegue:

* **Tablas faltantes en [schema.sql](file:///c:/Users/Natalia/OneDrive/Escritorio/agendaDocenteBACK/schema/schema.sql):**
  * Las rutas [licencias.js](file:///c:/Users/Natalia/OneDrive/Escritorio/agendaDocenteBACK/src/routes/licencias.js) y [libro_temas.js](file:///c:/Users/Natalia/OneDrive/Escritorio/agendaDocenteBACK/src/routes/libro_temas.js) ya consumen las tablas `licencias` y `libro_temas`, pero **no existen en el script de base de datos**. Si creas la base en producción, esos módulos van a dar error 500.
  * La tabla `planilla_oficial` y la vista del "Búmeran" (`v_alumnos_para_intensificar`) están detalladas en la documentación maestra pero no están creadas en el código de base de datos ni tienen sus rutas específicas implementadas.
* **Inconsistencia de Estados en Asistencias:**
  * En [schema.sql](file:///c:/Users/Natalia/OneDrive/Escritorio/agendaDocenteBACK/schema/schema.sql#L126), el campo `estado` tiene una restricción: `CHECK (estado IN ('presente', 'ausente', 'tardanza', 'justificado'))`.
  * Pero en [asistencias.js](file:///c:/Users/Natalia/OneDrive/Escritorio/agendaDocenteBACK/src/routes/asistencias.js#L113-L116) el cálculo estadístico filtra por siglas: `'P'`, `'A'`, `'T'`, `'AJ'`. Esto hace que el porcentaje de asistencia devuelva siempre 0% o falle el cálculo de regularidad.
* **Relación Escuela - Curso rota:**
  * En [cursos.js](file:///c:/Users/Natalia/OneDrive/Escritorio/agendaDocenteBACK/src/routes/cursos.js#L24-L32), en el `POST` para crear un curso, **no se está guardando `escuela_id`**, rompiendo la jerarquía del sistema (Escuelas > Cursos > Alumnos).
* **Subida real de certificados médicos:**
  * En [licencias.js](file:///c:/Users/Natalia/OneDrive/Escritorio/agendaDocenteBACK/src/routes/licencias.js) falta la subida de los archivos JPG/PDF a Supabase Storage (actualmente solo recibe texto y no guarda el puntero al archivo).
* **Seguridad del OCR con Gemini:**
  * En [ocr.js](file:///c:/Users/Natalia/OneDrive/Escritorio/agendaDocenteBACK/src/routes/ocr.js) usás `multer.memoryStorage()` sin límite de tamaño (`limits: { fileSize: 5 * 1024 * 1024 }`). Si varios usuarios suben fotos pesadas simultáneamente, pueden agotar la memoria RAM del servidor.

---

### 2. Seguridad, Robustez y Marco Legal (Crítico: Datos de Menores)

Este sistema almacena datos sumamente sensibles (nombres, DNI, faltas, notas y **condiciones especiales de salud/discapacidad de menores de edad** en [necesidades.js](file:///c:/Users/Natalia/OneDrive/Escritorio/agendaDocenteBACK/src/routes/necesidades.js)).

* **Marco Legal Argentino (Ley 25.326 de Protección de Datos Personales):**
  * Toda app comercial que gestione datos personales de terceros debe contar con **Términos y Condiciones** y una **Política de Privacidad** explícita.
  * Debes registrar las bases de datos ante la **AAIP** (Agencia de Acceso a la Información Pública).
* **Auditoría y Trazabilidad:**
  * En el ámbito educativo, cambiar una nota o borrar una falta tiene implicancias formales. Es recomendable contar con logs de auditoría (`audit_trail`) para registrar cuándo y quién editó una calificación.
* **Hardening del Servidor Express:**
  * Instalar `helmet` para cabeceras HTTP seguras.
  * Instalar `express-rate-limit` para evitar ataques de fuerza bruta y proteger endpoints costosos (como el OCR de Gemini).
  * Validación de esquemas (con `zod` o `joi`) para que ningún payload malicioso rompa el servidor.

---

### 3. Modelo de Negocio y Monetización (Pasarela de Pagos)

En la tabla de docentes tenés el campo `plan` (`gratuito` / `premium`). Para poder comercializarlo:

* **Integración con Mercado Pago:**
  * En Argentina es el estándar indiscutido. Necesitás integrar **Mercado Pago Suscripciones** (débito automático mensual) o Checkout Pro.
  * Crear webhooks en el backend (`/api/webhooks/mercadopago`) para activar o degradar el plan `premium` automáticamente ante el cobro o la falta de pago.
* **Definición de límites (Paywall / Feature Gating):**
  * **Plan Gratuito:** Por ejemplo, hasta 2 escuelas, 3 cursos y 40 alumnos, sin OCR con IA.
  * **Plan Premium:** Escuelas ilimitadas, cursos ilimitados, digitalización de planillas por foto (OCR), exportación a PDF oficial y alertas avanzadas.

---

### 4. La "Killer Feature" para Docentes: Exportación Oficial

Para que un docente pague todos los meses por esta aplicación, la clave es ahorrarle trabajo burocrático ante los directivos:
* **Generador de Planillas Oficiales en PDF / Excel:**
  * Los directores y secretarías escolares siguen exigiendo la planilla de calificaciones y el registro de asistencia en el formato impreso oficial de la Provincia.
  * Si agregás un botón: **"Descargar RINA / Planilla Oficial en PDF lista para imprimir"** con el formato exacto que pide el Ministerio, la aplicación se vuelve indispensable y se vende sola de boca en boca en las salas de profesores.

---

### 5. Frontend y Experiencia en el Aula (Offline / PWA)

* **Modo Offline (PWA):**
  * Las escuelas argentinas (especialmente subsuelos, edificios antiguos o zonas periféricas) muchas veces no tienen señal de datos ni Wi-Fi.
  * Si la app no permite tomar asistencia o anotar una observación sin conexión a internet para sincronizar después, el docente no la va a poder usar en el aula real. Un Service Worker con almacenamiento local (IndexedDB) es fundamental.
* **Velocidad de carga en móviles:**
  * Toma de lista con un toque (gestos rápidos: 1 toque = Presente, 2 toques = Ausente).

---

### 6. Infraestructura y Puesta en Producción

* **Limpieza de secretos:**
  * Archivos como `contrasesupabase.txt` y `google-key.json` deben ser eliminados del directorio local y manejados exclusivamente como variables de entorno seguras en el servidor de hosting.
* **Hosting en la nube:**
  * **Backend:** Alojar en plataformas como Render, Railway o Fly.io (con un proceso Node.js permanente y variables de entorno configuradas).
  * **Frontend:** Alojar en Vercel, Netlify o Cloudflare Pages.
* **Monitoreo y Alertas de Errores:**
  * Integrar herramientas como **Sentry** en el backend y frontend para enterarte si a un docente le falla una pantalla antes de que te lo reporte.

---

### 🚀 Plan de Acción Sugerido para el Lanzamiento

| Etapa | Objetivo | Tareas Principales |
| :--- | :--- | :--- |
| **Paso 1: Estabilización del Backend** | Eliminar bugs de schema | Unificar estados de asistencia, agregar `escuela_id` en cursos, completar `schema.sql` con `licencias` y `libro_temas`. |
| **Paso 2: Frontend & PWA (MVP)** | Producto usable | Construir la interfaz móvil (React/Vite), toma rápida de asistencia, calificaciones y perfil. |
| **Paso 3: Exportación a PDF/Excel** | Factor diferencial de venta | Implementar la descarga de la sábana de notas en formato oficial. |
| **Paso 4: Pagos & Planes** | Monetización | Conectar suscripciones de Mercado Pago y bloquear funciones avanzadas a usuarios gratuitos. |
| **Paso 5: Beta Cerrada (Feedback)** | Validación | Darle la app a 5 o 10 docentes conocidos durante 2 o 3 semanas para pulir detalles del uso diario. |
| **Paso 6: Lanzamiento Comercial** | Salida al mercado | Campañas en comunidades docentes (Instagram/TikTok docente, sindicatos, grupos de WhatsApp). |
