import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js'
import { supabaseAdmin, supabaseForUser } from '../config/supabase.js'

const router = Router();

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024
const MIME_TYPES_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp'])
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!MIME_TYPES_PERMITIDOS.has(file.mimetype)) {
      const error = new Error('Formato inválido. Subí una imagen JPG, PNG o WebP.')
      error.status = 415
      return callback(error)
    }
    return callback(null, true)
  },
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function validarPlanYCurso(req, cursoId) {
  const db = supabaseForUser(req.token)

  const { data: docente, error: docenteError } = await db
    .from('docentes')
    .select('id, plan, subscription_plan, trial_ends_at, is_vip_beta')
    .eq('id', req.user.id)
    .single()

  if (docenteError || !docente) {
    return { error: { code: 'OCR_PLAN_REQUIRED', message: 'No se pudo verificar tu plan.' }, status: 403 }
  }

  const ahora = new Date()
  const trialEndsAt = docente.trial_ends_at ? new Date(docente.trial_ends_at) : null
  const esVip = docente.is_vip_beta === true
  const plan = docente.plan
  const subscriptionPlan = docente.subscription_plan

  const tienePlanPago = (plan === 'pro' || plan === 'premium' || plan === 'basico') ||
                        (subscriptionPlan === 'pro' || subscriptionPlan === 'premium' || subscriptionPlan === 'basico')
  const tienePlanPagoConOcr = (plan === 'pro' || plan === 'premium') ||
                              (subscriptionPlan === 'pro' || subscriptionPlan === 'premium')

  if (esVip || plan === 'premium' || subscriptionPlan === 'premium') {
    return { docente, esPremium: true }
  }

  if (!tienePlanPagoConOcr || (trialEndsAt && trialEndsAt <= ahora)) {
    return { error: { code: 'OCR_PLAN_REQUIRED', message: 'El OCR requiere Plan PRO o Premium. Tu plan actual no lo incluye.' }, status: 403 }
  }

  if (plan === 'pro' || subscriptionPlan === 'pro') {
    const { data: usos, error: usosError } = await db
      .from('ocr_cursos_usados')
      .select('curso_id')
      .eq('docente_id', req.user.id)

    if (usosError) {
      return { error: { code: 'OCR_PLAN_REQUIRED', message: 'No se pudo verificar el uso de OCR.' }, status: 403 }
    }

    const cursosUsados = new Set((usos || []).map(u => u.curso_id))
    const yaUsadoEnEsteCurso = cursosUsados.has(cursoId)

    if (!yaUsadoEnEsteCurso && cursosUsados.size >= 5) {
      return { error: { code: 'OCR_CURSOS_LIMIT', message: 'El Plan PRO permite OCR en hasta 5 cursos distintos. Ya usaste tu límite.' }, status: 403 }
    }
  }

  return { docente }
}

async function validarCursoPerteneceADocente(req, cursoId) {
  const db = supabaseForUser(req.token)
  const { data: curso, error } = await db
    .from('cursos')
    .select('id, nombre')
    .eq('id', cursoId)
    .eq('docente_id', req.user.id)
    .maybeSingle()

  if (error) throw error
  if (!curso) {
    return { error: { code: 'OCR_CURSO_NO_ENCONTRADO', message: 'Curso no encontrado.' }, status: 404 }
  }
  return { curso }
}

async function registrarUsoOcr(docenteId, cursoId) {
  await supabaseAdmin
    .from('ocr_cursos_usados')
    .upsert({ docente_id: docenteId, curso_id: cursoId }, { onConflict: 'docente_id,curso_id' })
}

router.post('/process', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ninguna imagen' });
    }

    const cursoId = req.body?.curso_id
    if (!cursoId || !UUID_PATTERN.test(cursoId)) {
      return res.status(400).json({ error: { code: 'OCR_CURSO_REQUIRED', message: 'Se requiere el ID del curso (curso_id).' } });
    }

    if (!GEMINI_API_KEY) {
      return res.status(503).json({ error: 'El procesamiento de imágenes no está configurado.' });
    }

    const validacionCurso = await validarCursoPerteneceADocente(req, cursoId)
    if (validacionCurso.error) {
      return res.status(validacionCurso.error.status || 400).json({ error: validacionCurso.error })
    }

    const validacionPlan = await validarPlanYCurso(req, cursoId)
    if (validacionPlan.error) {
      return res.status(validacionPlan.error.status || 403).json({ error: validacionPlan.error })
    }

    const base64Image = req.file.buffer.toString('base64');

    const prompt = `
      Analiza esta imagen de una planilla de asistencia o calificaciones de alumnos. 
      Extrae los NOMBRES y APELLIDOS de los alumnos. 
      Ignora encabezados como "Escuela", "Curso", "Profesor", "Materia", firmas, fechas, etc.
      Ignora ruidos como números de documento, notas (TEA, TEP, números), faltas o presentes.
      Devuelve exclusivamente un objeto JSON con el siguiente formato:
      {
        "alumnos": [
          { "apellido": "APELLIDO", "nombre": "NOMBRE" },
          ...
        ]
      }
      Devuelve SOLO el JSON válido, sin ningún texto adicional, ni bloques markdown.
    `;

    const models = [
      'gemini-1.5-pro-latest', 
      'gemini-1.5-pro',
      'gemini-flash-latest', 
      'gemini-1.0-pro-vision-latest'
    ];
    
    let lastError = null;

    for (const model of models) {
      try {
        console.log(`🤖 IA: Intentando escanear con ${model}...`);
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inline_data: {
                      mime_type: req.file.mimetype,
                      data: base64Image
                    }
                  }
                ]
              }
            ]
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || `Error con el modelo ${model}`);
        }

        const data = await response.json();
        
        let resultText = data.candidates[0].content.parts[0].text;
        resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const resultJson = JSON.parse(resultText);
        console.log(`✅ ¡Éxito con ${model}! Detectados ${resultJson.alumnos?.length || 0} alumnos.`);
        
        await registrarUsoOcr(req.user.id, cursoId)
        
        return res.json({ alumnos: resultJson.alumnos || [] });

      } catch (err) {
        console.warn(`⚠️ ${model} falló o está saturado. Pasando al siguiente...`);
        lastError = err;
        continue;
      }
    }

    throw lastError;

  } catch (error) {
    console.error('❌ Error fatal en OCR con Gemini:', error);
    res.status(500).json({
      error: 'No se pudo procesar la imagen. Intentá nuevamente en unos minutos.',
    });
  }
});

export default router;