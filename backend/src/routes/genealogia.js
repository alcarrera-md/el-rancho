const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

const GENERACIONES_MAX = 3; // bisabuelos / bisnietos como límite razonable

// Sube por madre_id/padre_id hasta GENERACIONES_MAX niveles
async function obtenerAncestros(animalId) {
  const { rows } = await db.query(`
    WITH RECURSIVE ancestros AS (
      SELECT id, arete_id, nombre_alias, sexo, estado, madre_id, padre_id, 0 AS nivel, ARRAY[id] AS camino
      FROM animal WHERE id = $1
      UNION ALL
      SELECT a.id, a.arete_id, a.nombre_alias, a.sexo, a.estado, a.madre_id, a.padre_id, an.nivel + 1, an.camino || a.id
      FROM animal a
      JOIN ancestros an ON a.id = an.madre_id OR a.id = an.padre_id
      WHERE an.nivel < $2 AND NOT a.id = ANY(an.camino)
    )
    SELECT * FROM ancestros WHERE nivel > 0 ORDER BY nivel, sexo
  `, [animalId, GENERACIONES_MAX]);
  return rows;
}

// Baja buscando animales cuya madre_id/padre_id sea el actual, recursivamente
async function obtenerDescendientes(animalId) {
  const { rows } = await db.query(`
    WITH RECURSIVE descendientes AS (
      SELECT id, arete_id, nombre_alias, sexo, estado, madre_id, padre_id, 0 AS nivel, ARRAY[id] AS camino
      FROM animal WHERE id = $1
      UNION ALL
      SELECT a.id, a.arete_id, a.nombre_alias, a.sexo, a.estado, a.madre_id, a.padre_id, d.nivel + 1, d.camino || a.id
      FROM animal a
      JOIN descendientes d ON a.madre_id = d.id OR a.padre_id = d.id
      WHERE d.nivel < $2 AND NOT a.id = ANY(d.camino)
    )
    SELECT * FROM descendientes WHERE nivel > 0 ORDER BY nivel, sexo
  `, [animalId, GENERACIONES_MAX]);
  return rows;
}

// GET /api/genealogia/:id — árbol completo (ancestros + descendientes)
router.get('/:id', asyncHandler(async (req, res) => {
  const animal = await db.query('SELECT id, arete_id, nombre_alias, sexo, estado FROM animal WHERE id = $1', [req.params.id]);
  if (!animal.rows.length) return res.status(404).json({ error: 'Animal no encontrado' });

  const [ancestros, descendientes] = await Promise.all([
    obtenerAncestros(req.params.id),
    obtenerDescendientes(req.params.id),
  ]);

  res.json({ animal: animal.rows[0], ancestros, descendientes });
}));

// GET /api/genealogia/consanguinidad/verificar?madre_id=&padre_id=
// Compara los ancestros de ambos animales; si comparten alguno, avisa el
// parentesco (útil antes de registrar una monta, para evitar cruzar
// animales emparentados sin querer).
router.get('/consanguinidad/verificar', asyncHandler(async (req, res) => {
  const { madre_id, padre_id } = req.query;
  if (!madre_id || !padre_id) {
    return res.status(400).json({ error: 'madre_id y padre_id son obligatorios' });
  }

  if (String(madre_id) === String(padre_id)) {
    return res.json({ relacionados: true, mensaje: 'Es el mismo animal.' });
  }

  const [ancestrosMadre, ancestrosPadre] = await Promise.all([
    obtenerAncestros(madre_id),
    obtenerAncestros(padre_id),
  ]);

  // ¿El padre es ancestro de la madre, o viceversa? (caso directo, ej. padre-hija)
  if (ancestrosMadre.some((a) => String(a.id) === String(padre_id))) {
    return res.json({ relacionados: true, mensaje: 'El padre es ancestro directo de la madre (o el mismo animal).' });
  }
  if (ancestrosPadre.some((a) => String(a.id) === String(madre_id))) {
    return res.json({ relacionados: true, mensaje: 'La madre es ancestro directo del padre (o el mismo animal).' });
  }

  // ¿Comparten algún ancestro en común? (ej. medios hermanos, primos)
  const idsMadre = new Set(ancestrosMadre.map((a) => a.id));
  const comunes = ancestrosPadre.filter((a) => idsMadre.has(a.id));

  if (comunes.length > 0) {
    const masCercano = comunes.reduce((min, actual) => {
      const nivelActual = actual.nivel + (ancestrosMadre.find((a) => a.id === actual.id)?.nivel || 0);
      const nivelMin = min ? min.nivel + (ancestrosMadre.find((a) => a.id === min.id)?.nivel || 0) : Infinity;
      return nivelActual < nivelMin ? actual : min;
    }, null);
    return res.json({
      relacionados: true,
      mensaje: `Comparten un ancestro en común: ${masCercano.arete_id}${masCercano.nombre_alias ? ` (${masCercano.nombre_alias})` : ''}.`,
      ancestroComun: masCercano,
    });
  }

  res.json({ relacionados: false, mensaje: `No se encontró parentesco dentro de ${GENERACIONES_MAX} generaciones.` });
}));

module.exports = router;
