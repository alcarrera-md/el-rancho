const express = require('express');
const { integracion } = require('../errors');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { validar } = require('../middleware/validar');
const validaciones = require('../validation/asistente');
const { llamarGemini } = require('../gemini');
const { conversarConsultivo } = require('../asistenteConsultivo');
const { verificarContexto, firmarContexto } = require('../asistenteContexto');

const router = express.Router();

function mensajeProveedor(error, predeterminado) {
  if (error?.code === 'GEMINI_RATE_LIMIT') return 'El asistente está temporalmente saturado. Intenta nuevamente en unos segundos.';
  if (error?.code === 'GEMINI_SERVICE_UNAVAILABLE') return 'El proveedor de IA no está disponible temporalmente.';
  return predeterminado;
}

async function construirContextoAnimal(animalId) {
  const animal = await db.query(`
    SELECT a.arete_id,a.nombre_alias,a.sexo,a.fecha_nacimiento,a.estado,a.estado_salud,a.categoria,
           r.nombre AS raza,c.nombre AS corral_actual
    FROM animal a LEFT JOIN raza r ON r.id=a.raza_id LEFT JOIN corral c ON c.id=a.corral_actual_id
    WHERE a.id=$1`, [animalId]);
  if (!animal.rows.length) return null;
  const [pesajes, salud] = await Promise.all([
    db.query('SELECT fecha,peso_kg FROM pesaje WHERE animal_id=$1 ORDER BY fecha DESC LIMIT 5', [animalId]),
    db.query('SELECT tipo,enfermedad,descripcion,fecha,proxima_dosis FROM evento_salud WHERE animal_id=$1 ORDER BY fecha DESC LIMIT 8', [animalId]),
  ]);
  return { animal: animal.rows[0], pesajes: pesajes.rows, salud: salud.rows };
}

router.post('/resumen-animal/:id', asyncHandler(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
  const contexto = await construirContextoAnimal(Number(req.params.id));
  if (!contexto) return res.status(404).json({ error: 'Animal no encontrado' });
  const prompt = `Resume en español, en menos de 150 palabras, estos datos verificados de un animal. No inventes ni estimes datos ausentes. Separa resumen, explicación y recomendaciones prudentes. Datos: ${JSON.stringify(contexto)}`;
  try {
    const resultado = await llamarGemini([{ role: 'user', parts: [{ text: prompt }] }]);
    res.json({ resumen: resultado.text });
  } catch (error) {
    throw integracion(error.code || 'ASISTENTE_NO_DISPONIBLE', mensajeProveedor(error, 'No fue posible generar el resumen solicitado.'), error);
  }
}));

router.post('/chat', validar({ body: validaciones.mensajeChat }), asyncHandler(async (req, res) => {
  try {
    const contextoVerificado = verificarContexto(req.body.contexto, req.usuario);
    const respuesta = await conversarConsultivo({
      mensaje: req.body.mensaje,
      historial: req.body.historial,
      contexto: contextoVerificado,
      usuario: req.usuario,
      db,
    });
    const { _contexto, ...publica } = respuesta;
    res.json({ ...publica, contexto: firmarContexto(_contexto, req.usuario) });
  } catch (error) {
    console.warn('[asistente-telemetria]', {
      usuario_id: req.usuario.id,
      rol: req.usuario.rol,
      evento: 'error',
      error: error.code || 'ASISTENTE_ERROR',
      fecha: new Date().toISOString(),
    });
    throw integracion(
      error.code || 'ASISTENTE_NO_DISPONIBLE',
      mensajeProveedor(error, 'El asistente no está disponible en este momento. Los datos del sistema continúan funcionando normalmente.'),
      error,
    );
  }
}));

module.exports = router;
