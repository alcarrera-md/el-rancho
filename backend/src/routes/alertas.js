const express = require('express');
const { integracion } = require('../errors');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { obtenerConfiguracion } = require('../configuracion');
const { calcularClustersContacto, enriquecerClusters } = require('../clusterContacto');
const { llamarGemini } = require('../gemini');
const { obtenerResumenAlertas, obtenerAlertasHato, contarAfectados, ESTADOS_AFECTADO } = require('../alertasService');

const router = express.Router();

function fechaISO(fecha) {
  return fecha ? new Date(fecha).toISOString().slice(0, 10) : 'desconocida';
}

// GET /api/alertas/resumen
// Cuenta todo lo que necesita atención, para mostrar notificaciones (badges)
// sin que el usuario tenga que entrar a cada sección a revisar.
// Los umbrales (cuántos días, qué % de ocupación) vienen de la tabla "configuracion".
router.get('/resumen', asyncHandler(async (req, res) => {
  const config = await obtenerConfiguracion();
  res.json(await obtenerResumenAlertas(db, { config, usuario: req.usuario }));
}));

// ---------------------------------------------------------
// GET /api/alertas/hato
// Patrones a nivel de grupo — lo que un capataz de verdad vigila:
// clústeres de contacto con posibles brotes (animales enfermos agrupados
// transitivamente por haber compartido corral, no solo el corral actual),
// corrales completos con pesajes atrasados, y tendencia de mortalidad.
// ---------------------------------------------------------
router.get('/hato', asyncHandler(async (req, res) => {
  const config = await obtenerConfiguracion();

  res.json(await obtenerAlertasHato(db, config));
}));

// ---------------------------------------------------------
// POST /api/alertas/hato/analisis-ia
// Toma un animal de un clúster de contacto ya detectado y le pide a Gemini
// que evalúe, con los datos reales de contacto (quién compartió corral con
// quién y cuándo), si el patrón parece un brote real o una coincidencia.
// El clúster se recalcula aquí mismo a partir de la base de datos — nunca
// se confía en la membresía que mande el cliente.
// ---------------------------------------------------------
const RESPONSE_SCHEMA_BROTE = {
  type: 'OBJECT',
  properties: {
    probabilidad_real: { type: 'INTEGER', description: 'De 0 a 100: qué tan probable es que sea un brote real por contagio, y no una coincidencia' },
    veredicto: { type: 'STRING', enum: ['brote_probable', 'posible_coincidencia', 'datos_insuficientes'] },
    justificacion: { type: 'STRING', description: 'Explicación breve citando animales y fechas reales de los datos dados' },
    recomendaciones: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['probabilidad_real', 'veredicto', 'justificacion', 'recomendaciones'],
};

router.post('/hato/analisis-ia', asyncHandler(async (req, res) => {
  const { animal_id } = req.body;
  if (!animal_id) return res.status(400).json({ error: 'animal_id es obligatorio' });

  const config = await obtenerConfiguracion();
  const clustersCrudos = await calcularClustersContacto(config.dias_ventana_brote_ia);
  const clusterCrudo = clustersCrudos.find((c) => c.animal_ids.includes(Number(animal_id)));
  if (!clusterCrudo) {
    return res.status(404).json({ error: 'No se encontró un clúster de contacto para ese animal en la ventana configurada.' });
  }
  const [cluster] = await enriquecerClusters([clusterCrudo]);

  const ESTADO_SALUD_LABEL = { sano: 'sano', observacion: 'en observación', enfermo: 'enfermo' };
  let texto = `Grupo de ${cluster.animales.length} animales conectados por contacto (compartieron corral en algún momento, `;
  texto += `directa o transitivamente) en los últimos ${config.dias_ventana_brote_ia} días. Corrales involucrados: ${cluster.corrales.join(', ') || 'sin datos'}.\n\n`;
  texto += 'Animales del grupo:\n';
  texto += cluster.animales.map((a) => {
    let linea = `- ${a.nombre_alias || a.arete_id} (arete ${a.arete_id}): estado ${a.estado}, salud ${ESTADO_SALUD_LABEL[a.estado_salud] || a.estado_salud}`;
    if (ESTADOS_AFECTADO.includes(a.estado_salud)) {
      linea += `, desde ${a.salud_fecha_inicio ? fechaISO(a.salud_fecha_inicio) : 'fecha no registrada'}`;
      if (a.salud_diagnostico) linea += `, diagnóstico: ${a.salud_diagnostico}`;
    }
    return linea;
  }).join('\n');

  texto += '\n\nCadena de contactos (quién estuvo físicamente con quién, en qué corral y durante qué fechas):\n';
  texto += cluster.contactos.map((c) =>
    `- ${c.animal_a_nombre} y ${c.animal_b_nombre} compartieron el corral "${c.corral_nombre}" del ${fechaISO(c.desde)} al ${fechaISO(c.hasta)}`
  ).join('\n') || 'Sin traslapes registrados.';

  const prompt = `Eres un asistente veterinario que ayuda a un rancho ganadero en México a evaluar si un
grupo de animales que compartió corral recientemente representa un brote real de enfermedad contagiosa,
o si es una coincidencia (enfermedades no relacionadas entre sí, fechas de inicio muy alejadas del
contacto, o traslapes de tiempo demasiado breves o lejanos para explicar un contagio). Usa ÚNICAMENTE
los datos reales de abajo — no inventes nada. Ten en cuenta que entre más eslabones tenga la cadena de
contacto (A con B, B con C, sin que A y C se hayan visto directamente) y más tiempo haya pasado entre el
contacto y el inicio de la enfermedad, menos plausible es el contagio directo. Responde en español.

${texto}`;

  try {
    const parte = await llamarGemini([{ role: 'user', parts: [{ text: prompt }] }], { responseSchema: RESPONSE_SCHEMA_BROTE });
    res.json(JSON.parse(parte.text));
  } catch (err) {
    throw integracion('ANALISIS_IA_NO_DISPONIBLE', 'No fue posible generar el análisis solicitado.', err);
  }
}));

module.exports = router;
