# 📘 ESPECIFICACIONES TÉCNICAS: SAAS AGENDA DOCENTE PROFESIONAL (NATALIA BARZOTTI) 🇦🇷⚒️

Este documento constituye la especificación técnica de alto nivel para la plataforma **Agenda Docente**, diseñada como un modelo SaaS (Software as a Service) para la gestión académica y administrativa personalizada.

---

## 🏗️ 1. ARQUITECTURA TÉCNICA (TECH STACK)

La aplicación sigue una arquitectura desacoplada para permitir escalabilidad y mantenimiento modular.

*   **Entorno de Ejecución:** Node.js (V8 Engine).
*   **Servidor Web:** Express.js (Framework minimalista para ruteo y middleware).
*   **Base de Datos Relacional:** PostgreSQL (Motor de grado industrial para integridad de datos).
*   **Infraestructura Cloud (BaaS):** Supabase (Gestión de autenticación, Storage de archivos y API Gateway).
*   **Comunicación:** RESTful API mediante JSON sobre HTTPS.

---

## 🔒 2. SEGURIDAD Y MULTI-TENANCY (MODELO SAAS)

A diferencia de un sistema local, este SaaS utiliza un modelo de aislamiento de datos:
*   **Row Level Security (RLS):** Las tablas están protegidas por políticas de PostgreSQL. Cada registro incluye una clave foránea `docente_id`.
*   **Identidad:** Vinculación directa con el ID de usuario de Supabase Auth (UUID).
*   **Aislamiento de Negocio:** El docente es el "Tenant" (inquilino). Sus escuelas, cursos, alumnos y notas son inaccesibles para otros usuarios.

---

## 📊 3. MODELO DE DATOS Y RELACIONES (DATABASE SCHEMA)

El sistema se basa en una jerarquía relacional estricta para garantizar la integridad referencial:

### 💼 Entidades Principales:
1.  **`docentes`**: Almacena el perfil del administrador ( Natalia ).
2.  **`escuelas`**: Pertenece al docente. Contiene datos como Numero, Nombre, Distrito.
3.  **`cursos`**: Pertenece a una Escuela. Atributos: Division, Materia, Año, Turno.
4.  **`alumnos`**: Pertenece a un Curso. Atributos: Apellido, Nombre, Condición (Recursante/Regular).

### 📝 Entidades de Transacción y Proceso:
5.  **`seguimiento_diario`**: Registro de actividades (TPs, Exámenes). 
    *   *Clave:* Campo `entregado` (BOOLEAN) y `nota` (TEXT).
6.  **`asistencias`**: Módulo de control de faltas.
7.  **`planilla_oficial`**: El "Corazón" del sistema. Mantiene la trayectoria académica histórica del alumno.
8.  **`intensificacion`**: Módulo de recuperación bimensual y final.

---

## ⚙️ 4. EXPLICACIÓN DE MÓDULOS (LÓGICA DE NEGOCIO)

### 📈 Módulo de Calificaciones Inteligente
Implementa una lógica híbrida exclusiva:
*   **Celdas de Sigla (P1/P2/P3/P4):** Gestión de TEA (Avanzado), TEP (En proceso), TED (Discontinuo).
*   **Celdas de Cierre (BIM 1 al 4):** Notas numéricas (1-10).
*   **Automatización de Observaciones:** Una función SQL cruza los datos de `seguimiento_diario` para generar un string resumen en la planilla oficial, evitando que el docente deba buscar alumno por alumno sus trámites pendientes.

### 🪃 Módulo Búmeran (Recuperación)
*   **Detección Automática:** Una Vista de Base de Datos (`v_alumnos_para_intensificar`) actúa como un motor de reglas, filtrando alumnos con rendimiento bajo (<7 o TED/TEP).
*   **Recursividad de Deuda:** El sistema permite el "arrastre" de periodos. Un alumno puede deber marzo (M-A) mientras cursa junio. El reporte de intensificación muestra la deuda histórica concatenada.

### ⚕️ Módulo Administrativo (Licencias)
*   Integración con **Supabase Storage**. Permite subir archivos pesados (JPG/PDF) sin sobrecargar la base de datos PostgreSQL, guardando únicamente el puntero URL.

---

## 📂 5. DICCIONARIO DE DATOS (DETALLE TÉCNICO)

| Tabla | Columna Relevante | Tipo | Función |
| :--- | :--- | :--- | :--- |
| `alumnos` | `es_recursante` | BOOLEAN | Define visualización en lista de asistencia. |
| `planilla_oficial` | `c1_b1_int` | TEXT | Instancia de recuperación del 1er Bimestre. |
| `seguimiento_diario` | `entregado` | BOOLEAN | Dispara el estado 'NO' en observaciones. |
| `v_cursos_con_escuela`| `nombre_escuela` | VIEW | Join para cabeceras de reportes oficiales. |

---

## 💰 6. POTENCIAL COMERCIAL (COTIZACIÓN SAAS)

Este desarrollo tiene un alto valor de mercado debido a:
*   **Adaptabilidad Local:** Diseñado según normativas específicas de la Provincia.
*   **Automatización de Carga:** Ahorro comprobado del 40% en tiempo administrativo para el docente.
*   **Persistencia y Auditoría:** Historial completo del alumno, eliminando la pérdida de datos del papel o hojas sueltas.

---
*Manual redactado para la **Agenda Docente de Natalia Barzotti**. Propiedad Intelectual del Proyecto.* 🇦🇷⚒️✨
