# 📘 DOCUMENTACIÓN MAESTRA: AGENDA DOCENTE PROFESIONAL (NATALIA BARZOTTI) 🇦🇷⚒️

Este documento es el manual técnico y de usuario definitivo para la aplicación **Agenda Docente**, diseñada para la gestión integral de trayectorias educativas según la normativa provincial.

---

## 🏗️ 1. ARQUITECTURA DEL SISTEMA

*   **Backend:** Node.js + Express.
*   **Base de Datos:** Supabase (PostgreSQL).
*   **Seguridad:** Row Level Security (RLS) habilitado. Cada docente solo ve su propia información mediante `docente_id`.
*   **Almacenamiento (Storage):** Bucket `certificados` para fotos y PDFs de licencias médicas.

---

## 📊 2. MÓDULO DE CALIFICACIONES (PLANILLA OFICIAL)

La planilla oficial es una réplica exacta del anexo papel de la Provincia.

### 🧩 Estructura de Celdas:
*   **Parciales (P1-P2):** Guardan siglas (**TEA, TEP, TED**).
*   **Bimestres (BIM 1-4):** Guardan notas numéricas (**1 al 10**).
*   **Intensificación (INT):** Columnas azules (`c1_b1_int`, etc.) para notas de recuperación por bimestre. Aceptan números o **'A'** (Ausente).

### 📸 Instantánea de Observaciones (Automática):
El sistema cruza los datos de la planilla con el **Seguimiento Diario**.
*   **Lógica:** Genera un resumen visual del estilo: `TP1: 8 | TP2: NO | EVA: 7`.
*   **Alerta:** Los **'NO'** (falta de entrega) deben resaltarse en **ROJO** en el diseño del Frontend.

---

## 🪃 3. EL BÚMERAN DE INTENSIFICACIÓN

Módulo inteligente diseñado para que ningún alumno "se pierda" en el camino.

*   **Funcionalidad:** El sistema detecta automáticamente alumnos con **TED/TEP** o nota **menor a 7**.
*   **Lógica de Arrastre:** Si un alumno no acredita en el primer periodo (M-A), el sistema lo sigue mostrando en los siguientes periodos (M-J-J, etc.) con una etiqueta de deuda: **'DEBE M-A'**.
*   **Estados Dinámicos (UI):**
    *   `APROBADO`: Cuando se carga nota >= 7.
    *   `EN PROCESO`: Cuando el campo está vacío o tiene una 'A'.

---

## ⚕️ 4. GESTIÓN DE LICENCIAS MÉDICAS

Sistema de carga de licencias con persistencia de certificaciones.

*   **Campos Clave:** `tipo_licencia`, `desde` (fecha), `hasta` (fecha), `articulo`, `observaciones`, `certificado_url`.
*   **Circuito de Carga:** 
    1.  Subida del archivo (JPG/PNG/PDF) al bucket `certificados`.
    2.  Asignación de la URL al campo `certificado_url`.
    3.  Persistencia en la tabla `licencias`.

---

## 🛠️ 5. DICCIONARIO DE LA BASE DE DATOS (TABLAS CLAVE)

### 📋 Tabla: `planilla_oficial`
*   `c1_bim1_nota`: Nota numérica 1er Bimestre.
*   `c1_p1_sigla`: Sigla P1.
*   `c1_b1_int`: Nota intensificación 1er Bimestre.
*   `obs_seguimiento_auto`: (Calculada) Resumen de TPs y exámenes.

### 📋 Tabla: `seguimiento_diario`
*   `entregado`: BOOLEAN que define el estado de entrega del alumno.
*   `tipo`: (TP o EXAMEN).

### 📋 Tabla: `licencias`
*   `desde`, `hasta`: Fechas de inicio y fin (Mantenidas en español por requerimiento).
*   `certificado_url`: Link al archivo en el Storage.

---

## 🛂 6. DIRECTIVAS PARA EL DESARROLLO (FRONTEND)

*   **Idioma:** Todas las claves de los objetos JSON **DEBEN** ser en **Español** para coincidir con la base de datos oficial.
*   **Protección de Datos:** El Backend maneja el `docente_id` automáticamente; el Front no debe manipular IDs de usuarios en el `POST`.
*   **Vistas:** Usar siempre las vistas precalculadas (`v_planilla_oficial`, `v_alumnos_para_intensificar`) para garantizar la coherencia de los datos.

---

*Documentación generada para la **Agenda Docente de Natalia Barzotti**. Año 2026.* 🇦🇷⚒️✨
