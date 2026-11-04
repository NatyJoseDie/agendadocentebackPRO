import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js'

const router = Router();

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024
const MIME_TYPES_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp'])
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

router.post('/process', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ninguna imagen' });
    }

    if (!GEMINI_API_KEY) {
      return res.status(503).json({ error: 'El procesamiento de imágenes no está configurado.' });
    }

    const base64Image = req.file.buffer.toString('base64');
    
    // Prompt de alta precisión
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

    // Lista de modelos de Gemini ordenados por prioridad. 
    // Si flash-latest está saturado, usamos las versiones PRO que suelen estar más libres.
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
