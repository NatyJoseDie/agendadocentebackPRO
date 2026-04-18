# 📘 PROYECTO MASTER: AGENDA DOCENTE PROFESIONAL (SaaS) 🇦🇷⚒️
**Natalia Barzotti - Especificaciones Técnico-Funcionales y Plan de Producto (2026)**

---

## 🏗️ 1. VISIÓN DEL PRODUCTO (CORE MISSION)
La **Agenda Docente** no es una simple aplicación de notas; es una plataforma **SaaS (Software as a Service)** diseñada para digitalizar la trayectoria educativa provincial. Elimina el error humano del papel y automatiza la burocracia pedagógica mediante inteligencia de datos.

---

## 📊 2. MÓDULOS DEL SISTEMA (PERSPECTIVA FUNCIONAL / USUARIO)

### 📝 2.1. Gestión Académica Jerárquica
El sistema sigue la estructura real de trabajo: **Escuelas > Cursos > Alumnos**.
*   **Aislamiento de Cursos:** Cada curso es un ecosistema cerrado con su propia lista de asistencia y seguimiento.

### 📸 2.2. Seguimiento Diario e Instantáneas
Permite registrar TPs y Exámenes con un solo clic (`entregado: SI/NO`).
*   **Automatización:** Genera automáticamente el campo "Observaciones de Trayectoria" en la planilla oficial (Ej: `TP1: 8 | TP2: NO`). ¡El docente ya no tiene que pasar datos a mano!

### 📊 2.3. Planilla Oficial de Calificaciones (Anexo Digital)
Réplica exacta de la planilla de papel provincial:
*   **Parciales y Bimestres:** Soporte híbrido de siglas (TEA, TEP, TED) y notas numéricas (1-10).
*   **Columnas INT:** Instancias de Intensificación bimensuales integradas en la misma sábana.

### 🪃 2.4. Búmeran de Intensificación (Motor de Reglas)
Un sistema de detección temprana:
*   **Criterio:** Filtra alumnos con rendimiento < 7 o TED/TEP.
*   **Lógica de Arrastre (Carry-over):** Si un alumno debe un bloque (M-A, M-J-J, etc.), el sistema lo "persigue" en los siguientes reportes hasta que acredita la deuda. Acepta notas numéricas o la letra **'A' (Ausente)**.

---

## ⚕️ 3. MÓDULO ADMINISTRATIVO (LICENCIAS MÉDICAS)

Sistema de gestión de ausencias con persistencia de documentación:
*   **Flujo:** Selección de Artículo (ej: 114.a.1) + Carga de Fecha + **Storage Bucket** (Certificados médicos digitalizados).
*   **Idioma Mandatorio:** Claves de persistencia en Español (`tipo_licencia`, `fecha_inicio`, `fecha_fin`).

---

## 🏛️ 4. ARQUITECTURA DEL SISTEMA (PERSPECTIVA TÉCNICA / DESARROLLADOR)

### 🧱 4.1. Stack Tecnológico
*   **Servidor:** Node.js + Express.js.
*   **Base de Datos Relacional:** PostgreSQL (Supabase BaaS).
*   **Almacenamiento (Storage):** Buckets públicos para archivos multimedia de certificados.

### 🔐 4.2. Seguridad Multi-Tenant (SaaS)
*   **Aislamiento:** Implementado mediante **Row Level Security (RLS)** a nivel de base de datos. Cada docente tiene una clave única (`docente_id` UUID).
*   **Políticas:** El servidor solo permite operaciones `ALL` si el `docente_id` del registro coincide con el `auth.uid()` del usuario autenticado.

### 🧩 4.3. Diccionario de Datos (Modelos Clave)
*   **`planilla_oficial`**: Repositorio central de notas e intensificaciones.
*   **`v_alumnos_para_intensificar`**: Vista precalculada que ejecuta el algoritmo de "arrastre" de deuda.
*   **`v_cursos_con_escuela`**: Vista para inyectar cabeceras reales (Escuela/Número) en los reportes del Frontend.

---

## 💰 5. VALOR COMERCIAL Y COTIZACIÓN (BUSINESS LOGIC)

Este SaaS tiene un valor diferencial por su **Localización Normativa**. No es un CRM genérico; es un sistema adaptado a las leyes de educación vigentes.
*   **Escalabilidad:** El backend está diseñado para soportar miles de docentes en paralelo sin cruce de información.
*   **Propiedad Intelectual:** Incluye lógica propietaria para el cálculo de cierres bimestrales y estados de trayectoria educativa.

---
*Documento Final de Especificaciones para **Agenda Docente de Natalia Barzotti**. Propiedad del Proyecto.* 🏆🇦🇷✨
