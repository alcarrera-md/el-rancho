const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { obtenerConfiguracion } = require('../configuracion');

const router = express.Router();

// ---------------------------------------------------------
// GET /api/reportes/resumen
// Reúne los indicadores clave del rancho para el dashboard
// de reportes: totales, peso promedio por corral y ventas por mes.
// ---------------------------------------------------------
router.get('/resumen', asyncHandler(async (req, res) => {
  const [
    totalAnimales,
    ingresosTotales,
    pesoPromedioPorCorral,
    ventasPorMes,
    animalesPorEstado,
    mortalidad,
    reproduccion,
    ganancia,
    animalesPorCategoria,
    animalesPorEstadoSalud,
    pesoPromedioGeneral,
  ] = await Promise.all([
    db.query(`SELECT COUNT(*) AS total FROM animal WHERE estado = 'vivo'`),
    db.query(`SELECT COALESCE(SUM(precio), 0) AS total FROM venta`),
    db.query(`
      SELECT c.nombre AS corral, ROUND(AVG(ultimo.peso_kg), 1) AS peso_promedio, COUNT(*) AS animales
      FROM corral c
      JOIN animal a ON a.corral_actual_id = c.id AND a.estado = 'vivo'
      JOIN LATERAL (
        SELECT peso_kg FROM pesaje p WHERE p.animal_id = a.id ORDER BY fecha DESC LIMIT 1
      ) ultimo ON true
      GROUP BY c.nombre
      ORDER BY c.nombre
    `),
    db.query(`
      SELECT to_char(date_trunc('month', fecha), 'YYYY-MM') AS mes, SUM(precio) AS total
      FROM venta
      GROUP BY date_trunc('month', fecha)
      ORDER BY date_trunc('month', fecha)
    `),
    db.query(`SELECT estado, COUNT(*) AS total FROM animal GROUP BY estado`),
    // Tasa de mortalidad: % de animales registrados alguna vez que terminaron muertos
    db.query(`
      SELECT COUNT(*) FILTER (WHERE estado = 'muerto') AS muertos, COUNT(*) AS total
      FROM animal
    `),
    // La tasa clínica de preñez requiere diagnósticos y una población elegible
    // bien definida. P0 deja de publicar la razón histórica de partos como si
    // fuera esa tasa; se mantiene únicamente la aproximación de supervivencia.
    db.query(`
      SELECT
        (SELECT COUNT(*) FROM evento_reproductivo er JOIN animal a ON a.id = er.cria_id WHERE a.estado != 'muerto') AS crias_vivas,
        (SELECT COUNT(*) FROM evento_reproductivo WHERE cria_id IS NOT NULL) AS crias_totales
    `),
    // Ganancia de peso promedio diaria: compara primer y último pesaje de cada animal
    db.query(`
      SELECT AVG((ultimo.peso_kg - primero.peso_kg) / NULLIF((ultimo.fecha - primero.fecha), 0)) AS promedio
      FROM (SELECT DISTINCT animal_id FROM pesaje) ids
      JOIN LATERAL (
        SELECT peso_kg, fecha FROM pesaje p WHERE p.animal_id = ids.animal_id ORDER BY fecha ASC LIMIT 1
      ) primero ON true
      JOIN LATERAL (
        SELECT peso_kg, fecha FROM pesaje p WHERE p.animal_id = ids.animal_id ORDER BY fecha DESC LIMIT 1
      ) ultimo ON true
      WHERE ultimo.fecha > primero.fecha
    `),
    // Vacas/toros/terneros: el sistema no guarda esa taxonomía directamente,
    // se deriva de sexo + categoria (mismos campos que ya usa el resto del
    // sistema para categorías). Terneros = cría/destete; vacas = hembras en
    // etapa vientre/reproductora; toros = machos reproductores.
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE categoria IN ('cria', 'destete')) AS terneros,
        COUNT(*) FILTER (WHERE sexo = 'hembra' AND categoria IN ('vientre', 'reproductor')) AS vacas,
        COUNT(*) FILTER (WHERE sexo = 'macho' AND categoria = 'reproductor') AS toros
      FROM animal WHERE estado = 'vivo'
    `),
    db.query(`SELECT estado_salud, COUNT(*) AS total FROM animal WHERE estado = 'vivo' GROUP BY estado_salud`),
    db.query(`
      SELECT ROUND(AVG(ultimo.peso_kg), 1) AS promedio
      FROM animal a
      JOIN LATERAL (
        SELECT peso_kg FROM pesaje p WHERE p.animal_id = a.id ORDER BY fecha DESC LIMIT 1
      ) ultimo ON true
      WHERE a.estado = 'vivo'
    `),
  ]);

  const muertos = Number(mortalidad.rows[0].muertos);
  const totalHistorico = Number(mortalidad.rows[0].total);
  const r = reproduccion.rows[0];

  res.json({
    total_animales_vivos: Number(totalAnimales.rows[0].total),
    ingresos_totales: Number(ingresosTotales.rows[0].total),
    peso_promedio_por_corral: pesoPromedioPorCorral.rows,
    ventas_por_mes: ventasPorMes.rows,
    animales_por_estado: animalesPorEstado.rows,
    tasa_mortalidad: totalHistorico > 0 ? Number(((muertos / totalHistorico) * 100).toFixed(1)) : null,
    tasa_prenez: null,
    tasa_prenez_estado: 'no_disponible_datos_actuales',
    tasa_destete: Number(r.crias_totales) > 0 ? Number(((r.crias_vivas / r.crias_totales) * 100).toFixed(1)) : null,
    ganancia_diaria_promedio_kg: ganancia.rows[0].promedio ? Number(Number(ganancia.rows[0].promedio).toFixed(2)) : null,
    animales_por_categoria: {
      terneros: Number(animalesPorCategoria.rows[0].terneros),
      vacas: Number(animalesPorCategoria.rows[0].vacas),
      toros: Number(animalesPorCategoria.rows[0].toros),
    },
    animales_por_estado_salud: animalesPorEstadoSalud.rows.map((r2) => ({ estado_salud: r2.estado_salud, total: Number(r2.total) })),
    peso_promedio_kg: pesoPromedioGeneral.rows[0].promedio ? Number(pesoPromedioGeneral.rows[0].promedio) : null,
  });
}));

// ---------------------------------------------------------
// GET /api/reportes/rentabilidad
// Costo estimado (compra + alimentación + salud, según el costo
// promedio real de tus compras de insumos) contra ingreso (venta,
// y opcionalmente leche si se configuró un precio por litro).
// Es una ESTIMACIÓN: la alimentación/salud no guardan costo exacto
// por evento, así que se usa el costo promedio de compra del insumo.
// ---------------------------------------------------------
router.get('/rentabilidad', asyncHandler(async (req, res) => {
  const config = await obtenerConfiguracion();
  const { estado } = req.query;

  const { rows } = await db.query(`
    WITH costo_insumo AS (
      SELECT insumo_id, SUM(costo_total) / NULLIF(SUM(cantidad), 0) AS costo_unitario
      FROM compra_insumo WHERE costo_total IS NOT NULL GROUP BY insumo_id
    )
    SELECT
      a.id, a.arete_id, a.nombre_alias, a.estado,
      COALESCE(ca.precio, 0) AS costo_compra,
      COALESCE((
        SELECT SUM(al.cantidad * ci.costo_unitario)
        FROM alimentacion al JOIN costo_insumo ci ON ci.insumo_id = al.insumo_id
        WHERE al.animal_id = a.id
      ), 0) AS costo_alimentacion,
      COALESCE((
        SELECT SUM(ci.costo_unitario)
        FROM evento_salud es JOIN costo_insumo ci ON ci.insumo_id = es.insumo_id
        WHERE es.animal_id = a.id
      ), 0) AS costo_salud,
      COALESCE(v.precio, 0) AS ingreso_venta,
      COALESCE((SELECT SUM(litros) FROM produccion_leche pl WHERE pl.animal_id = a.id), 0) AS litros_totales
    FROM animal a
    LEFT JOIN compra_animal ca ON ca.animal_id = a.id
    LEFT JOIN venta v ON v.animal_id = a.id
    ${estado ? 'WHERE a.estado = $1' : ''}
    ORDER BY a.id DESC
  `, estado ? [estado] : []);

  const resultado = rows.map((r) => {
    const costo_compra = Number(r.costo_compra);
    const costo_alimentacion = Number(r.costo_alimentacion);
    const costo_salud = Number(r.costo_salud);
    const ingreso_venta = Number(r.ingreso_venta);
    const ingreso_leche = Number(r.litros_totales) * config.precio_leche_litro;
    const costo_total = costo_compra + costo_alimentacion + costo_salud;
    const ingreso_total = ingreso_venta + ingreso_leche;
    return {
      id: r.id, arete_id: r.arete_id, nombre_alias: r.nombre_alias, estado: r.estado,
      costo_compra, costo_alimentacion, costo_salud, costo_total,
      ingreso_venta, ingreso_leche, ingreso_total,
      neto: Number((ingreso_total - costo_total).toFixed(2)),
    };
  }).sort((a, b) => b.neto - a.neto);

  res.json({ precio_leche_litro: config.precio_leche_litro, animales: resultado });
}));

// ---------------------------------------------------------
// GET /api/reportes/financiero
// Estado de resultados simplificado del rancho completo (no por
// animal): todo el dinero que entró contra todo el que salió,
// en un periodo. A diferencia de "rentabilidad" (que usa costo
// promedio estimado por animal), aquí se suma el gasto REAL de
// cada compra y gasto general — es la vista de "caja" del negocio.
// ---------------------------------------------------------
router.get('/financiero', asyncHandler(async (req, res) => {
  const config = await obtenerConfiguracion();
  const { desde, hasta } = req.query;
  const condicionFecha = (columna) => {
    const partes = [];
    const valores = [];
    if (desde) { valores.push(desde); partes.push(`${columna} >= $${valores.length}`); }
    if (hasta) { valores.push(hasta); partes.push(`${columna} <= $${valores.length}`); }
    return { where: partes.length ? `WHERE ${partes.join(' AND ')}` : '', valores };
  };

  const fVenta = condicionFecha('fecha');
  const fLeche = condicionFecha('fecha');
  const fCompraInsumo = condicionFecha('fecha');
  const fCompraAnimal = condicionFecha('fecha');
  const fGasto = condicionFecha('g.fecha');
  const fGastoPorMes = condicionFecha('fecha');
  const fCostoReproductivo = condicionFecha('fecha');
  const soloCostoNuevo = `${fCostoReproductivo.where} ${fCostoReproductivo.where ? 'AND' : 'WHERE'} gasto_general_id IS NULL AND compra_insumo_id IS NULL`;

  const [ingresosVenta, litrosLeche, gastoInsumos, gastoAnimales, gastoGeneral, gastoReproductivo, gastosPorCategoria, gastosPorMes, costoReproductivoPorMes, ingresosPorMes] = await Promise.all([
    db.query(`SELECT COALESCE(SUM(precio), 0) AS total FROM venta ${fVenta.where}`, fVenta.valores),
    db.query(`SELECT COALESCE(SUM(litros), 0) AS total FROM produccion_leche ${fLeche.where}`, fLeche.valores),
    db.query(`SELECT COALESCE(SUM(costo_total), 0) AS total FROM compra_insumo ${fCompraInsumo.where}`, fCompraInsumo.valores),
    db.query(`SELECT COALESCE(SUM(precio), 0) AS total FROM compra_animal ${fCompraAnimal.where}`, fCompraAnimal.valores),
    db.query(`SELECT COALESCE(SUM(monto), 0) AS total FROM gasto_general g ${fGasto.where}`, fGasto.valores),
    db.query(`SELECT COALESCE(SUM(monto), 0) AS total FROM costo_reproductivo ${soloCostoNuevo}`, fCostoReproductivo.valores),
    db.query(`
      SELECT c.nombre AS categoria, COALESCE(SUM(g.monto), 0) AS total
      FROM gasto_general g JOIN categoria_gasto c ON c.id = g.categoria_id
      ${fGasto.where}
      GROUP BY c.nombre ORDER BY total DESC
    `, fGasto.valores),
    db.query(`
      SELECT to_char(date_trunc('month', fecha), 'YYYY-MM') AS mes, SUM(monto) AS total
      FROM gasto_general ${fGastoPorMes.where}
      GROUP BY date_trunc('month', fecha) ORDER BY date_trunc('month', fecha)
    `, fGastoPorMes.valores),
    db.query(`
      SELECT to_char(date_trunc('month', fecha), 'YYYY-MM') AS mes, SUM(monto) AS total
      FROM costo_reproductivo ${soloCostoNuevo}
      GROUP BY date_trunc('month', fecha) ORDER BY date_trunc('month', fecha)
    `, fCostoReproductivo.valores),
    db.query(`
      SELECT to_char(date_trunc('month', fecha), 'YYYY-MM') AS mes, SUM(precio) AS total
      FROM venta ${fVenta.where}
      GROUP BY date_trunc('month', fecha) ORDER BY date_trunc('month', fecha)
    `, fVenta.valores),
  ]);

  const ingresoVentaNum = Number(ingresosVenta.rows[0].total);
  const ingresoLecheNum = Number(litrosLeche.rows[0].total) * config.precio_leche_litro;
  const gastoInsumosNum = Number(gastoInsumos.rows[0].total);
  const gastoAnimalesNum = Number(gastoAnimales.rows[0].total);
  const gastoGeneralNum = Number(gastoGeneral.rows[0].total);
  const gastoReproductivoNum = Number(gastoReproductivo.rows[0].total);

  const ingresosTotales = ingresoVentaNum + ingresoLecheNum;
  const gastosTotales = gastoInsumosNum + gastoAnimalesNum + gastoGeneralNum + gastoReproductivoNum;
  const meses = new Map(gastosPorMes.rows.map((fila) => [fila.mes, Number(fila.total)]));
  costoReproductivoPorMes.rows.forEach((fila) => meses.set(fila.mes, (meses.get(fila.mes) || 0) + Number(fila.total)));

  res.json({
    ingresos: { ventas: ingresoVentaNum, leche: Number(ingresoLecheNum.toFixed(2)), total: Number(ingresosTotales.toFixed(2)) },
    gastos: {
      insumos: gastoInsumosNum, animales: gastoAnimalesNum, generales: gastoGeneralNum,
      reproductivos: gastoReproductivoNum,
      total: Number(gastosTotales.toFixed(2)),
    },
    utilidad_neta: Number((ingresosTotales - gastosTotales).toFixed(2)),
    gastos_por_categoria: [...gastosPorCategoria.rows, ...(gastoReproductivoNum ? [{ categoria: 'Reproducción directa', total: gastoReproductivo.rows[0].total }] : [])],
    gastos_por_mes: [...meses.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, total]) => ({ mes, total: total.toFixed(2) })),
    ingresos_por_mes: ingresosPorMes.rows,
  });
}));

module.exports = router;
