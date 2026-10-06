const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { upload } = require('../upload');
const { registrarBitacora } = require('../bitacora');
const { obtenerConfiguracion } = require('../configuracion');
const { validar } = require('../middleware/validar');
const { paramsId } = require('../validation/comun');
const validaciones = require('../validation/animales');
const { conflicto, crearError } = require('../errors');
const { enTransaccion } = require('../transaction');
const { mensajePublicoError } = require('../middleware/errorHandler');
const { ejecutarIdempotente, responderIdempotente } = require('../idempotency');
const { CONDICION_DELGADA_MAX, CONDICION_SOBREPESO_MIN } = require('../reglasCondicionCorporal');

const router = express.Router();

const DIA_MS = 1000 * 60 * 60 * 24;

// Motor de recomendaciones: reglas simples y transparentes basadas
// únicamente en los datos que ya existen para ese animal — nada de
// "caja negra", cada recomendación se puede explicar con un dato concreto.
function calcularRecomendaciones({ animal, pesajes, salud, reproduccion, gestacion, leche, resumenLeche, condicion, config, planSanitario }) {
  const hoy = new Date();
  const recomendaciones = [];

  if (animal.estado_salud === 'enfermo') {
    recomendaciones.push({
      tipo: 'salud',
      mensaje: `Marcado como enfermo${animal.salud_fecha_inicio ? ` desde el ${animal.salud_fecha_inicio}` : ''}.${animal.salud_tratamiento ? ` Tratamiento actual: ${animal.salud_tratamiento}.` : ' Todavía no se registró un tratamiento.'}`,
    });
  } else if (animal.estado_salud === 'observacion') {
    recomendaciones.push({ tipo: 'salud', mensaje: 'Marcado en observación. Dale seguimiento cercano en los próximos días.' });
  }

  if (pesajes.length === 0) {
    recomendaciones.push({ tipo: 'pesaje', mensaje: 'Todavía no tiene ningún pesaje registrado. Registra el primero para empezar a monitorear su crecimiento.' });
  } else {
    const ultimo = pesajes[pesajes.length - 1];
    const dias = Math.floor((hoy - new Date(ultimo.fecha)) / DIA_MS);
    if (dias > config.dias_sin_pesaje_alerta) {
      recomendaciones.push({ tipo: 'pesaje', mensaje: `Han pasado ${dias} días desde su último pesaje. Considera pesarlo pronto.` });
    }
    if (pesajes.length >= 2) {
      const penultimo = pesajes[pesajes.length - 2];
      const diasEntre = (new Date(ultimo.fecha) - new Date(penultimo.fecha)) / DIA_MS;
      if (diasEntre > 0) {
        const ganancia = (ultimo.peso_kg - penultimo.peso_kg) / diasEntre;
        if (ganancia < 0) {
          recomendaciones.push({ tipo: 'salud', mensaje: `Perdió peso entre sus últimos dos pesajes (${penultimo.peso_kg} kg → ${ultimo.peso_kg} kg). Revisa su salud o alimentación.` });
        } else if (ganancia < config.ganancia_diaria_minima_kg) {
          recomendaciones.push({ tipo: 'alimentacion', mensaje: `Su ganancia de peso reciente es baja (${ganancia.toFixed(2)} kg/día). Revisa su plan de alimentación.` });
        }
      }
    }
  }

  if (condicion && condicion.length > 0) {
    const ultima = condicion[condicion.length - 1];
    if (ultima.puntuacion <= CONDICION_DELGADA_MAX) {
      recomendaciones.push({ tipo: 'alimentacion', mensaje: `Su última condición corporal fue ${ultima.puntuacion}/5 (delgada). Revisa su plan de alimentación.` });
    } else if (ultima.puntuacion >= CONDICION_SOBREPESO_MIN) {
      recomendaciones.push({ tipo: 'alimentacion', mensaje: `Su última condición corporal fue ${ultima.puntuacion}/5 (sobrepeso). Considera ajustar su alimentación.` });
    }
  }

  const vencidas = salud.filter((s) => s.proxima_dosis && new Date(s.proxima_dosis) < hoy);
  if (vencidas.length) {
    const masReciente = vencidas[vencidas.length - 1];
    recomendaciones.push({ tipo: 'salud', mensaje: `Tiene una dosis de refuerzo vencida desde el ${masReciente.proxima_dosis}. Aplícala lo antes posible.` });
  }
  const proximas = salud.filter((s) => s.proxima_dosis && new Date(s.proxima_dosis) >= hoy && (new Date(s.proxima_dosis) - hoy) / DIA_MS <= config.dias_alerta_vacuna);
  if (proximas.length) {
    recomendaciones.push({ tipo: 'salud', mensaje: `Tiene una dosis programada para el ${proximas[0].proxima_dosis}.` });
  }

  if (animal.sexo === 'hembra' && animal.estado === 'vivo') {
    const pendiente = gestacion[0];
    if (pendiente) {
      const diasParaParto = (new Date(pendiente.fecha_parto_estimada) - hoy) / DIA_MS;
      if (diasParaParto < 0) {
        recomendaciones.push({ tipo: 'reproduccion', mensaje: `La fecha estimada de parto (${pendiente.fecha_parto_estimada}) ya pasó sin registro de parto. Verifica su estado.` });
      } else if (diasParaParto <= config.dias_alerta_parto) {
        recomendaciones.push({ tipo: 'reproduccion', mensaje: `Parto estimado en ${Math.round(diasParaParto)} días (${pendiente.fecha_parto_estimada}). Prepara el corral de maternidad.` });
      }
    } else if (animal.fecha_nacimiento) {
      const edadMeses = (hoy - new Date(animal.fecha_nacimiento)) / (DIA_MS * 30);
      if (edadMeses >= 15) {
        const ultimaMonta = reproduccion[reproduccion.length - 1];
        const mesesDesde = ultimaMonta ? (hoy - new Date(ultimaMonta.fecha_monta)) / (DIA_MS * 30) : null;
        if (!ultimaMonta || mesesDesde > 12) {
          recomendaciones.push({ tipo: 'reproduccion', mensaje: 'No tiene actividad reproductiva reciente. Considera evaluarla para monta.' });
        }
      }
    }
  }

  if (animal.sexo === 'hembra' && leche.length > 0) {
    const ultimoRegistro = leche[leche.length - 1];
    const diasSinOrdeno = Math.floor((hoy - new Date(ultimoRegistro.fecha)) / DIA_MS);
    if (diasSinOrdeno > config.dias_sin_ordeno_alerta) {
      recomendaciones.push({ tipo: 'leche', mensaje: `No se registra producción de leche desde hace ${diasSinOrdeno} día(s).` });
    }
    if (resumenLeche) {
      const actual = Number(resumenLeche.litros_semana_actual);
      const anterior = Number(resumenLeche.litros_semana_anterior);
      if (anterior > 0) {
        const variacion = ((actual - anterior) / anterior) * 100;
        if (variacion <= -config.pct_caida_leche_alerta) {
          recomendaciones.push({
            tipo: 'leche',
            mensaje: `Su producción de leche esta semana (${actual} L) bajó ${Math.abs(variacion).toFixed(0)}% respecto a la semana anterior (${anterior} L). Revisa su salud o alimentación.`,
          });
        }
      }
    }
  }

  if (planSanitario && planSanitario.length > 0) {
    const vencidos = planSanitario.filter((p) => p.estado === 'vencido');
    vencidos.forEach((p) => {
      recomendaciones.push({
        tipo: 'salud',
        mensaje: `Según su plan "${p.plan_nombre}", le toca "${p.nombre_evento}" desde el ${new Date(p.fecha_objetivo).toLocaleDateString('es-MX')}.`,
      });
    });
  }

  if (recomendaciones.length === 0) {
    recomendaciones.push({ tipo: 'ok', mensaje: 'No hay pendientes urgentes para este animal por ahora.' });
  }

  return recomendaciones;
}

// ---------------------------------------------------------
// GET /api/animales
// Lista de animales con filtros básicos (?estado=vivo&corral_id=3&q=arete)
// ---------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const { estado, corral_id, q, sexo, estado_salud, categoria } = req.query;
  const condiciones = [];
  const valores = [];

  if (estado) {
    valores.push(estado);
    condiciones.push(`a.estado = $${valores.length}`);
  }
  if (corral_id) {
    valores.push(corral_id);
    condiciones.push(`a.corral_actual_id = $${valores.length}`);
  }
  if (sexo) {
    valores.push(sexo);
    condiciones.push(`a.sexo = $${valores.length}`);
  }
  if (estado_salud) {
    valores.push(estado_salud);
    condiciones.push(`a.estado_salud = $${valores.length}`);
  }
  if (categoria) {
    valores.push(categoria.split(','));
    condiciones.push(`a.categoria = ANY($${valores.length})`);
  }
  if (q) {
    valores.push(`%${q}%`);
    condiciones.push(`(a.arete_id ILIKE $${valores.length} OR a.nombre_alias ILIKE $${valores.length})`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT a.*, r.nombre AS raza, c.nombre AS corral_actual, ultimo.peso_kg AS ultimo_peso_kg
     FROM animal a
     LEFT JOIN raza r ON r.id = a.raza_id
     LEFT JOIN corral c ON c.id = a.corral_actual_id
     LEFT JOIN LATERAL (
       SELECT peso_kg FROM pesaje p WHERE p.animal_id = a.id ORDER BY fecha DESC LIMIT 1
     ) ultimo ON true
     ${where}
     ORDER BY a.id DESC`,
    valores
  );
  res.json(rows);
}));

// ---------------------------------------------------------
// GET /api/animales/:id
// Datos básicos de un animal
// ---------------------------------------------------------
router.get('/:id', validar({ params: paramsId }), asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM vista_ficha_animal WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Animal no encontrado' });
  res.json(rows[0]);
}));

// ---------------------------------------------------------
// GET /api/animales/:id/historial
// *** ENDPOINT ESTRELLA ***
// Devuelve la ficha completa: datos generales + línea de tiempo
// de todos los eventos del animal, ordenada cronológicamente.
// ---------------------------------------------------------
router.get('/:id/historial', validar({ params: paramsId }), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const animal = await db.query(
    `SELECT a.*, r.nombre AS raza, c.nombre AS corral_actual,
            madre.arete_id AS madre_arete, padre.arete_id AS padre_arete
     FROM animal a
     LEFT JOIN raza r ON r.id = a.raza_id
     LEFT JOIN corral c ON c.id = a.corral_actual_id
     LEFT JOIN animal madre ON madre.id = a.madre_id
     LEFT JOIN animal padre ON padre.id = a.padre_id
     WHERE a.id = $1`,
    [id]
  );

  if (!animal.rows.length) return res.status(404).json({ error: 'Animal no encontrado' });

  const [pesajes, salud, alimentacion, reproduccion, movimientos, venta, compra, crias, leche, resumenLeche, condicion, historialCategoria, notas, gestacion, config] = await Promise.all([
    db.query('SELECT id, fecha, peso_kg, observacion FROM pesaje WHERE animal_id = $1 ORDER BY fecha', [id]),
    db.query(
      `SELECT id, tipo, enfermedad, descripcion, fecha, proxima_dosis
       FROM evento_salud WHERE animal_id = $1 ORDER BY fecha`, [id]),
    db.query(
      `SELECT al.id, al.fecha, al.cantidad, i.nombre AS insumo, i.unidad_medida
       FROM alimentacion al JOIN insumo i ON i.id = al.insumo_id
       WHERE al.animal_id = $1 ORDER BY al.fecha`, [id]),
    db.query(
      `WITH config_repro AS (
         SELECT COALESCE((SELECT valor::int FROM configuracion WHERE clave='dias_gestacion_bovina'),283) dias
       )
       SELECT id, tipo_monta, fecha_monta, fecha_parto_estimada, fecha_parto_real, resultado, cria_id
       FROM evento_reproductivo WHERE madre_id = $1
       UNION ALL
       SELECT sr.id, sr.tipo, sr.fecha,
              COALESCE(sr.fecha_parto_estimada_ajustada, sr.fecha + config_repro.dias),
              pr.fecha_real,
              COALESCE(cr.resultado_final, 'pendiente'),
              NULL::integer
       FROM servicio_reproductivo sr
       JOIN ciclo_reproductivo cr ON cr.id=sr.ciclo_id
       LEFT JOIN parto_reproductivo pr ON pr.ciclo_id=cr.id
       CROSS JOIN config_repro
       WHERE cr.hembra_id=$1 AND sr.origen <> 'migracion_legado'
       ORDER BY fecha_monta`, [id]),
    db.query(
      `SELECT m.id, m.fecha, m.motivo, co.nombre AS corral_origen, cd.nombre AS corral_destino
       FROM movimiento_corral m
       LEFT JOIN corral co ON co.id = m.corral_origen
       JOIN corral cd ON cd.id = m.corral_destino
       WHERE m.animal_id = $1 ORDER BY m.fecha`, [id]),
    db.query(
      `SELECT v.fecha, v.precio, v.factura_folio, t.nombre AS comprador
       FROM venta v JOIN tercero t ON t.id = v.tercero_id WHERE v.animal_id = $1`, [id]),
    db.query(
      `SELECT ca.fecha, ca.precio, ca.identificacion_previa, t.id AS tercero_id, t.nombre AS proveedor
       FROM compra_animal ca JOIN tercero t ON t.id = ca.tercero_id WHERE ca.animal_id = $1`, [id]),
    db.query('SELECT id, arete_id, fecha_nacimiento FROM animal WHERE madre_id = $1 OR padre_id = $1', [id]),
    db.query('SELECT id, fecha, turno, litros, observacion FROM produccion_leche WHERE animal_id = $1 ORDER BY fecha, turno', [id]),
    db.query(`
      SELECT
        COALESCE(SUM(litros) FILTER (WHERE fecha = CURRENT_DATE), 0) AS litros_hoy,
        COALESCE(SUM(litros) FILTER (WHERE fecha >= date_trunc('week', CURRENT_DATE)), 0) AS litros_semana_actual,
        COALESCE(SUM(litros) FILTER (
          WHERE fecha >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days'
            AND fecha < date_trunc('week', CURRENT_DATE)
        ), 0) AS litros_semana_anterior,
        COALESCE(SUM(litros) FILTER (WHERE fecha >= date_trunc('month', CURRENT_DATE)), 0) AS litros_mes_actual
      FROM produccion_leche WHERE animal_id = $1
    `, [id]),
    db.query('SELECT id, fecha, puntuacion, observacion FROM condicion_corporal WHERE animal_id = $1 ORDER BY fecha', [id]),
    db.query('SELECT id, categoria_anterior, categoria_nueva, fecha, motivo FROM historial_categoria WHERE animal_id = $1 ORDER BY fecha', [id]),
    db.query(
      `SELECT n.id, n.tag, n.contenido, n.fecha, u.nombre AS usuario
       FROM nota_seguimiento n LEFT JOIN usuario u ON u.id = n.usuario_id
       WHERE n.animal_id = $1 ORDER BY n.fecha DESC`, [id]),
    db.query(`
      WITH ultimo_diagnostico AS (
        SELECT DISTINCT ON (ciclo_id) ciclo_id, resultado, servicio_id
        FROM diagnostico_gestacion ORDER BY ciclo_id, fecha DESC, id DESC
      ), config_repro AS (
        SELECT COALESCE((SELECT valor::int FROM configuracion WHERE clave='dias_gestacion_bovina'),283) dias
      )
      SELECT sr.fecha AS fecha_monta,
             COALESCE(sr.fecha_parto_estimada_ajustada, sr.fecha + config_repro.dias) AS fecha_parto_estimada
      FROM ciclo_reproductivo cr
      JOIN ultimo_diagnostico ud ON ud.ciclo_id=cr.id AND ud.resultado='prenada'
      JOIN servicio_reproductivo sr ON sr.id=ud.servicio_id
      CROSS JOIN config_repro
      WHERE cr.hembra_id=$1 AND cr.fecha_cierre IS NULL`, [id]),
    obtenerConfiguracion(),
  ]);

  const planSanitario = await db.query(`
    SELECT
      aps.id AS asignacion_id, p.id AS plan_id, p.nombre AS plan_nombre,
      pi.id AS item_id, pi.nombre_evento, pi.tipo, pi.insumo_id, pi.edad_dias,
      i.nombre AS insumo_nombre,
      a.fecha_nacimiento + (pi.edad_dias || ' days')::interval AS fecha_objetivo,
      es.id AS evento_salud_id
    FROM animal_plan_sanitario aps
    JOIN plan_sanitario p ON p.id = aps.plan_id AND p.activo = true
    JOIN plan_sanitario_item pi ON pi.plan_id = p.id
    JOIN animal a ON a.id = aps.animal_id
    LEFT JOIN insumo i ON i.id = pi.insumo_id
    LEFT JOIN evento_salud es ON es.animal_id = aps.animal_id AND es.plan_item_id = pi.id
    WHERE aps.animal_id = $1 AND a.fecha_nacimiento IS NOT NULL
    ORDER BY fecha_objetivo
  `, [id]);
  const hoyRef = new Date();
  const planSanitarioConEstado = planSanitario.rows.map((r) => ({
    ...r,
    estado: r.evento_salud_id ? 'aplicado' : (new Date(r.fecha_objetivo) < hoyRef ? 'vencido' : 'proximo'),
  }));

  // Se arma una línea de tiempo unificada combinando todos los eventos
  const timeline = [
    ...pesajes.rows.map((e) => ({ fecha: e.fecha, tipo: 'pesaje', detalle: e })),
    ...salud.rows.map((e) => ({ fecha: e.fecha, tipo: 'salud', detalle: e })),
    ...alimentacion.rows.map((e) => ({ fecha: e.fecha, tipo: 'alimentacion', detalle: e })),
    ...reproduccion.rows.map((e) => ({ fecha: e.fecha_monta, tipo: 'reproduccion', detalle: e })),
    ...movimientos.rows.map((e) => ({ fecha: e.fecha, tipo: 'movimiento', detalle: e })),
    ...leche.rows.map((e) => ({ fecha: e.fecha, tipo: 'leche', detalle: e })),
    ...condicion.rows.map((e) => ({ fecha: e.fecha, tipo: 'condicion', detalle: e })),
    ...historialCategoria.rows.map((e) => ({ fecha: e.fecha, tipo: 'categoria', detalle: e })),
  ].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  const recomendaciones = calcularRecomendaciones({
    animal: animal.rows[0], pesajes: pesajes.rows, salud: salud.rows, reproduccion: reproduccion.rows, gestacion: gestacion.rows,
    leche: leche.rows, resumenLeche: resumenLeche.rows[0], condicion: condicion.rows, config,
    planSanitario: planSanitarioConEstado,
  });

  const rentab = await db.query(`
    WITH costo_insumo AS (
      SELECT insumo_id, SUM(costo_total) / NULLIF(SUM(cantidad), 0) AS costo_unitario
      FROM compra_insumo WHERE costo_total IS NOT NULL GROUP BY insumo_id
    )
    SELECT
      COALESCE((SELECT precio FROM compra_animal WHERE animal_id = $1), 0) AS costo_compra,
      COALESCE((
        SELECT SUM(al.cantidad * ci.costo_unitario)
        FROM alimentacion al JOIN costo_insumo ci ON ci.insumo_id = al.insumo_id WHERE al.animal_id = $1
      ), 0) AS costo_alimentacion,
      COALESCE((
        SELECT SUM(ci.costo_unitario)
        FROM evento_salud es JOIN costo_insumo ci ON ci.insumo_id = es.insumo_id WHERE es.animal_id = $1
      ), 0) AS costo_salud,
      COALESCE((SELECT precio FROM venta WHERE animal_id = $1), 0) AS ingreso_venta,
      COALESCE((SELECT SUM(litros) FROM produccion_leche WHERE animal_id = $1), 0) AS litros_totales
  `, [id]);
  const rr = rentab.rows[0];
  const costoTotalAnimal = Number(rr.costo_compra) + Number(rr.costo_alimentacion) + Number(rr.costo_salud);
  const ingresoLecheAnimal = Number(rr.litros_totales) * config.precio_leche_litro;
  const ingresoTotalAnimal = Number(rr.ingreso_venta) + ingresoLecheAnimal;
  const rentabilidad = {
    costo_compra: Number(rr.costo_compra),
    costo_alimentacion: Number(rr.costo_alimentacion),
    costo_salud: Number(rr.costo_salud),
    costo_total: Number(costoTotalAnimal.toFixed(2)),
    ingreso_venta: Number(rr.ingreso_venta),
    ingreso_leche: Number(ingresoLecheAnimal.toFixed(2)),
    ingreso_total: Number(ingresoTotalAnimal.toFixed(2)),
    neto: Number((ingresoTotalAnimal - costoTotalAnimal).toFixed(2)),
  };

  res.json({
    animal: animal.rows[0],
    venta: venta.rows[0] || null,
    compra: compra.rows[0] || null,
    crias: crias.rows,
    resumen: {
      total_pesajes: pesajes.rows.length,
      total_eventos_salud: salud.rows.length,
      total_eventos_reproductivos: reproduccion.rows.length,
      ultimo_peso: pesajes.rows.at(-1) || null,
    },
    resumen_leche: animal.rows[0].sexo === 'hembra' ? resumenLeche.rows[0] : null,
    recomendaciones,
    notas: notas.rows,
    plan_sanitario: planSanitarioConEstado,
    rentabilidad,
    timeline,
  });
}));

// ---------------------------------------------------------
// POST /api/animales
// Alta de animal (nacimiento o ingreso externo). Acepta
// multipart/form-data con un campo de archivo "foto" opcional.
// ---------------------------------------------------------
router.post('/', upload.single('foto'), validar({ body: validaciones.alta }), asyncHandler(async (req, res) => {
  const {
    arete_id, nombre_alias, sexo, fecha_nacimiento, raza_id,
    madre_id, padre_id, origen, corral_actual_id, peso_nacimiento_kg,
  } = req.body;

  if (!arete_id || !sexo) {
    return res.status(400).json({ error: 'arete_id y sexo son obligatorios' });
  }

  const foto_url = req.file ? `/uploads/${req.file.filename}` : null;

  const animal = await enTransaccion(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO animal
        (arete_id, nombre_alias, sexo, fecha_nacimiento, raza_id, madre_id, padre_id, origen, corral_actual_id, peso_nacimiento_kg, foto_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'nacimiento'),$9,$10,$11)
       RETURNING *`,
      [arete_id, nombre_alias, sexo, fecha_nacimiento || null, raza_id || null, madre_id || null,
       padre_id || null, origen, corral_actual_id || null, peso_nacimiento_kg || null, foto_url]
    );
    await registrarBitacora(req.usuario, 'crear_animal', 'animal', rows[0].id, { despues: rows[0] }, client);
    return rows[0];
  });

  res.status(201).json(animal);
}));

// ---------------------------------------------------------
// POST /api/animales/importar
// Alta masiva de animales desde una plantilla de Excel ya procesada
// en el navegador. Recibe una lista de objetos (uno por fila).
// Cada fila se procesa por separado: si una falla (arete duplicado,
// datos inválidos), las demás se siguen importando de todas formas.
// La raza se crea automáticamente si no existe; el corral solo se
// asigna si ya existe uno con ese nombre exacto (no se crea uno nuevo,
// porque el corral tiene una capacidad que hay que definir a propósito).
// ---------------------------------------------------------
router.post('/importar', validar({ body: validaciones.importacion }), asyncHandler(async (req, res) => {
  const { animales } = req.body;
  if (!Array.isArray(animales) || animales.length === 0) {
    return res.status(400).json({ error: 'animales (lista) es obligatorio' });
  }

  const creados = [];
  const errores = [];

  for (const [index, fila] of animales.entries()) {
    try {
      if (!fila.arete_id || !fila.sexo) {
        throw crearError('IMPORT_ROW_INVALID', 'Falta el arete o el sexo.', 400);
      }
      const sexo = String(fila.sexo).toLowerCase();
      if (!['hembra', 'macho'].includes(sexo)) {
        throw crearError('IMPORT_ROW_INVALID', `Sexo inválido: "${fila.sexo}" (debe ser "hembra" o "macho").`, 400);
      }

      const creado = await enTransaccion(async (client) => {
        let raza_id = null;
        if (fila.raza) {
          const razaRes = await client.query(
            `INSERT INTO raza (nombre) VALUES ($1)
             ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`,
            [fila.raza]
          );
          raza_id = razaRes.rows[0].id;
        }

        let corral_actual_id = null;
        if (fila.corral) {
          const corralRes = await client.query('SELECT id FROM corral WHERE nombre = $1', [fila.corral]);
          if (corralRes.rows.length) corral_actual_id = corralRes.rows[0].id;
        }

        const { rows } = await client.query(
          `INSERT INTO animal (arete_id, nombre_alias, sexo, fecha_nacimiento, raza_id, peso_nacimiento_kg, origen, corral_actual_id)
           VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7,'nacimiento'), $8) RETURNING *`,
          [
            fila.arete_id, fila.nombre_alias || null, sexo, fila.fecha_nacimiento || null,
            raza_id, fila.peso_nacimiento_kg || null, fila.origen || null, corral_actual_id,
          ]
        );
        await registrarBitacora(req.usuario, 'importar_animal', 'animal', rows[0].id, {
          despues: rows[0], contexto: { fila: fila.fila || index + 2 },
        }, client);
        return rows[0];
      });
      creados.push(creado);
    } catch (err) {
      errores.push({ fila: fila.fila || index + 2, arete_id: fila.arete_id || '(sin arete)', error: mensajePublicoError(err) });
    }
  }

  res.status(201).json({ creados, errores });
}));

// ---------------------------------------------------------
// PATCH /api/animales/:id
// Edición de datos generales del animal (corrige datos mal capturados).
// Acepta multipart/form-data con una nueva "foto" opcional.
// ---------------------------------------------------------
router.patch('/:id', upload.single('foto'), validar({ params: paramsId, body: validaciones.edicion }), asyncHandler(async (req, res) => {
  const { nombre_alias, sexo, fecha_nacimiento, raza_id, madre_id, padre_id, peso_nacimiento_kg } = req.body;

  const foto_url = req.file ? `/uploads/${req.file.filename}` : undefined;

  const animal = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM animal WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    const { rows } = await client.query(
      `UPDATE animal SET
         nombre_alias = COALESCE($1, nombre_alias), sexo = COALESCE($2, sexo),
         fecha_nacimiento = COALESCE($3, fecha_nacimiento), raza_id = COALESCE($4, raza_id),
         madre_id = COALESCE($5, madre_id), padre_id = COALESCE($6, padre_id),
         peso_nacimiento_kg = COALESCE($7, peso_nacimiento_kg), foto_url = COALESCE($8, foto_url)
       WHERE id = $9 RETURNING *`,
      [nombre_alias || null, sexo || null, fecha_nacimiento || null, raza_id || null,
       madre_id || null, padre_id || null, peso_nacimiento_kg || null, foto_url, req.params.id]
    );
    await registrarBitacora(req.usuario, 'editar_animal', 'animal', rows[0].id, {
      antes: anterior.rows[0], despues: rows[0],
    }, client);
    return rows[0];
  });
  if (!animal) return res.status(404).json({ error: 'Animal no encontrado' });
  res.json(animal);
}));

// ---------------------------------------------------------
// PATCH /api/animales/:id/corral
// Traslado de animal a otro corral (valida capacidad vía trigger de BD)
// ---------------------------------------------------------
router.patch('/:id/corral', validar({ params: paramsId, body: validaciones.traslado }), asyncHandler(async (req, res) => {
  const {
    corral_id, corral_origen_id, expected_version, estado_observado,
    destino_ocupacion_observada, destino_capacidad_observada,
  } = req.body;
  const ejecucion = await ejecutarIdempotente(req, {
    tipo: 'animal.trasladar',
    entidad: 'animal',
    payload: req.body,
    entidadId: (resultado) => resultado?.animal?.id,
    httpStatus: 200,
  }, async (client, contexto) => {
    if (contexto.offline && (expected_version === undefined || estado_observado === undefined || !Object.hasOwn(req.body, 'corral_origen_id'))) {
      throw crearError(
        'OFFLINE_MOVEMENT_CONTEXT_REQUIRED',
        'El movimiento offline necesita la ubicación, estado y versión sincronizados del animal.',
        400
      );
    }
    const anterior = await client.query(
      `SELECT a.id, a.arete_id, a.nombre_alias, a.estado, a.corral_actual_id, a.version,
              origen.nombre AS corral_actual,
              COALESCE((SELECT MAX(m.id) FROM movimiento_corral m WHERE m.animal_id = a.id), 0) AS ultimo_movimiento_id
       FROM animal a
       LEFT JOIN corral origen ON origen.id = a.corral_actual_id
       WHERE a.id = $1
       FOR UPDATE OF a`,
      [req.params.id]
    );
    if (!anterior.rows.length) {
      throw crearError('ANIMAL_NO_ENCONTRADO', 'No se encontró el animal solicitado.', 404);
    }
    const animalActual = anterior.rows[0];
    if (animalActual.estado !== 'vivo') {
      throw crearError('ANIMAL_INACTIVO', 'El animal ya no está activo y no puede trasladarse.', 409, {
        details: [{ field: 'estado', message: 'El movimiento no fue aplicado.', observado: estado_observado, actual: animalActual.estado }],
      });
    }
    if (contexto.offline && Number(animalActual.corral_actual_id) !== Number(corral_origen_id)) {
      throw crearError('ANIMAL_CORRAL_CAMBIO', 'El animal cambió de corral mientras estabas sin conexión.', 409, {
        details: [{
          field: 'corral_origen_id',
          message: 'Vuelve a capturar usando la ubicación actual.',
          observado: corral_origen_id ?? null,
          actual: animalActual.corral_actual_id,
          destino: Number(corral_id),
          corral_observado: corral_origen_id ?? null,
          corral_actual: animalActual.corral_actual,
        }],
      });
    }
    if (contexto.offline && Number(animalActual.version) !== Number(expected_version)) {
      throw crearError('ANIMAL_VERSION_CONFLICT', 'El animal cambió desde la última sincronización.', 409, {
        details: [{ field: 'version', message: 'Vuelve a capturar con los datos actuales.', version_observada: Number(expected_version), version_actual: Number(animalActual.version) }],
      });
    }
    if (Number(animalActual.corral_actual_id) === Number(corral_id)) {
      throw crearError('CORRAL_DESTINO_IGUAL_ORIGEN', 'El animal ya se encuentra en el corral seleccionado.', 409);
    }

    // El bloqueo del destino serializa a animales distintos que compiten
    // por el último espacio. El trigger de BD permanece como defensa final.
    const destino = await client.query(
      'SELECT id, nombre, capacidad_maxima, activo FROM corral WHERE id = $1 FOR UPDATE',
      [corral_id]
    );
    if (!destino.rows.length) {
      throw crearError('CORRAL_NO_ENCONTRADO', 'No se encontró el corral de destino.', 404);
    }
    if (!destino.rows[0].activo) {
      throw crearError('CORRAL_INACTIVO', 'El corral de destino ya no está activo.', 409);
    }
    const ocupacion = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM animal
       WHERE corral_actual_id = $1 AND estado = 'vivo' AND id <> $2`,
      [corral_id, req.params.id]
    );
    if (ocupacion.rows[0].total >= destino.rows[0].capacidad_maxima) {
      throw crearError('CORRAL_SIN_CAPACIDAD', 'El corral destino ya no tiene capacidad disponible.', 409, {
        details: [{
          field: 'corral_id',
          message: 'Selecciona otro destino.',
          corral_destino: destino.rows[0].nombre,
          observado: destino_ocupacion_observada,
          actual: ocupacion.rows[0].total,
          capacidad_observada: destino_capacidad_observada,
          capacidad_actual: destino.rows[0].capacidad_maxima,
        }],
      });
    }

    const { rows } = await client.query(
      'UPDATE animal SET corral_actual_id = $1 WHERE id = $2 RETURNING *',
      [corral_id, req.params.id]
    );
    await registrarBitacora(req.usuario, 'trasladar_animal', 'animal', rows[0].id, {
      antes: anterior.rows[0], despues: { id: rows[0].id, corral_actual_id: rows[0].corral_actual_id },
    }, client);
    const movimiento = await client.query(
      `SELECT m.id, m.animal_id, m.fecha, m.motivo, m.trabajador_id,
              co.nombre AS corral_origen, cd.nombre AS corral_destino,
              t.nombre AS responsable
       FROM movimiento_corral m
       LEFT JOIN corral co ON co.id = m.corral_origen
       JOIN corral cd ON cd.id = m.corral_destino
       LEFT JOIN trabajador t ON t.id = m.trabajador_id
       WHERE m.animal_id = $1 AND m.id > $2
       ORDER BY m.id DESC
       LIMIT 1`,
      [rows[0].id, anterior.rows[0].ultimo_movimiento_id]
    );
    if (!movimiento.rows[0]) {
      throw crearError('MOVIMIENTO_NO_REGISTRADO', 'No se pudo confirmar el historial del traslado.', 500);
    }
    return { animal: rows[0], movimiento: movimiento.rows[0] };
  });
  return responderIdempotente(res, ejecucion);
}));

// ---------------------------------------------------------
// PATCH /api/animales/:id/baja
// Registrar sacrificio o muerte. El estado "vendido" se reserva a /api/ventas
// para garantizar que toda venta tenga su registro comercial correspondiente.
// ---------------------------------------------------------
router.patch('/:id/baja', validar({ params: paramsId, body: validaciones.baja }), asyncHandler(async (req, res) => {
  const { estado, razon_baja, fecha_baja } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const actual = await client.query(
      'SELECT id, estado, razon_baja, fecha_baja FROM animal WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (!actual.rows.length) {
      throw crearError('ANIMAL_NO_ENCONTRADO', 'No se encontró el animal solicitado.', 404);
    }
    if (actual.rows[0].estado !== 'vivo') {
      throw crearError(
        'TRANSICION_ESTADO_INVALIDA',
        'El estado actual del animal no permite registrar esta baja.',
        409,
        { details: [{ estado_actual: actual.rows[0].estado, estado_solicitado: estado }] }
      );
    }
    const { rows } = await client.query(
      `UPDATE animal SET estado = $1, razon_baja = $2, fecha_baja = COALESCE($3, CURRENT_DATE)
       WHERE id = $4 RETURNING *`,
      [estado, razon_baja, fecha_baja, req.params.id]
    );
    await registrarBitacora(req.usuario, 'dar_baja_animal', 'animal', rows[0].id, {
      antes: actual.rows[0],
      despues: { id: rows[0].id, estado: rows[0].estado, razon_baja: rows[0].razon_baja, fecha_baja: rows[0].fecha_baja },
    }, client);
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ---------------------------------------------------------
// PATCH /api/animales/:id/estado-salud
// Cambia la "banderita" de salud (sano/observación/enfermo).
// Los campos de diagnóstico/tratamiento solo tienen sentido si es "enfermo".
// ---------------------------------------------------------
router.patch('/:id/estado-salud', validar({ params: paramsId, body: validaciones.estadoSalud }), asyncHandler(async (req, res) => {
  const { estado_salud, salud_fecha_inicio, salud_diagnostico, salud_tratamiento } = req.body;
  if (!['sano', 'observacion', 'enfermo'].includes(estado_salud)) {
    return res.status(400).json({ error: 'estado_salud debe ser sano, observacion o enfermo' });
  }
  const esEnfermo = estado_salud === 'enfermo';
  const ejecucion = await ejecutarIdempotente(req, {
    tipo: estado_salud === 'observacion' ? 'animal.reportar_observacion' : 'animal.estado_clinico',
    entidad: 'animal',
    payload: { params: { id: req.params.id }, body: req.body },
  }, async (client, contexto) => {
    if (contexto.offline && estado_salud !== 'observacion') {
      throw crearError('OFFLINE_OPERATION_UNSUPPORTED', 'Offline v1 sólo permite reportar que un animal requiere revisión.', 400);
    }
    const anterior = await client.query(
      'SELECT id, estado, estado_salud, salud_fecha_inicio, salud_diagnostico, salud_tratamiento FROM animal WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (!anterior.rows.length) return null;
    if (contexto.offline && anterior.rows[0].estado !== 'vivo') {
      throw conflicto('ANIMAL_INACTIVO', 'El animal ya no está activo y no puede recibir esta observación.');
    }
    const { rows } = await client.query(
      `UPDATE animal SET estado_salud = $1, salud_fecha_inicio = $2,
         salud_diagnostico = $3, salud_tratamiento = $4 WHERE id = $5 RETURNING *`,
      [estado_salud, esEnfermo ? (salud_fecha_inicio || null) : null,
       esEnfermo ? (salud_diagnostico || null) : null,
       esEnfermo ? (salud_tratamiento || null) : null, req.params.id]
    );
    await registrarBitacora(req.usuario, 'cambiar_estado_salud', 'animal', rows[0].id, {
      antes: anterior.rows[0],
      despues: {
        id: rows[0].id, estado_salud: rows[0].estado_salud,
        salud_fecha_inicio: rows[0].salud_fecha_inicio,
        salud_diagnostico: rows[0].salud_diagnostico,
        salud_tratamiento: rows[0].salud_tratamiento,
      },
    }, client);
    return rows[0];
  });
  if (!ejecucion.resultado) return res.status(404).json({ error: 'Animal no encontrado' });
  return responderIdempotente(res, ejecucion);
}));

// ---------------------------------------------------------
// PATCH /api/animales/:id/categoria
// Cambia la categoría/etapa productiva del animal y deja constancia en el historial
// ---------------------------------------------------------
router.patch('/:id/categoria', validar({ params: paramsId }), asyncHandler(async (req, res) => {
  const { categoria, motivo } = req.body;
  const categoriasValidas = ['cria', 'destete', 'engorde', 'vientre', 'reproductor', 'descarte'];
  if (!categoriasValidas.includes(categoria)) {
    return res.status(400).json({ error: `categoria debe ser una de: ${categoriasValidas.join(', ')}` });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const actual = await client.query('SELECT categoria FROM animal WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!actual.rows.length) {
      throw crearError('ANIMAL_NO_ENCONTRADO', 'No se encontró el animal solicitado.', 404);
    }
    const categoriaAnterior = actual.rows[0].categoria;

    const { rows } = await client.query(
      'UPDATE animal SET categoria = $1 WHERE id = $2 RETURNING *',
      [categoria, req.params.id]
    );
    await client.query(
      `INSERT INTO historial_categoria (animal_id, categoria_anterior, categoria_nueva, motivo)
       VALUES ($1,$2,$3,$4)`,
      [req.params.id, categoriaAnterior, categoria, motivo || null]
    );

    await registrarBitacora(req.usuario, 'cambiar_categoria', 'animal', rows[0].id, {
      antes: { categoria: categoriaAnterior },
      despues: { categoria },
      contexto: { motivo: motivo || null },
    }, client);
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
