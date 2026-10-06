// Conteos de alertas del sistema. Los usan el badge de Inicio / Alertas
// (routes/alertas.js) y el asistente. `hoy` es opcional: la ruta conserva
// CURRENT_DATE del servidor y el asistente pasa la fecha del rancho.

const { calcularClustersContacto, enriquecerClusters } = require('./clusterContacto');

const ROLES_TAREAS_PROPIAS = ['Veterinario', 'Trabajador'];
const ESTADOS_AFECTADO = ['enfermo', 'observacion'];

function contarAfectados(cluster) {
  return cluster.animales.filter((a) => ESTADOS_AFECTADO.includes(a.estado_salud)).length;
}

async function obtenerResumenAlertas(db, { config, usuario, hoy = null }) {
  const soloTareasPropias = ROLES_TAREAS_PROPIAS.includes(usuario?.rol);
  const [vacunas, stock, partos, corrales, tareas, planSanitario] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS total FROM evento_salud
       WHERE proxima_dosis IS NOT NULL
         AND proxima_dosis BETWEEN COALESCE($2::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) + $1::int`,
      [config.dias_alerta_vacuna, hoy]
    ),
    db.query('SELECT COUNT(*) AS total FROM insumo WHERE stock_actual <= stock_minimo'),
    db.query(
      `WITH ultimo_diagnostico AS (
         SELECT DISTINCT ON (ciclo_id) ciclo_id, resultado, servicio_id
         FROM diagnostico_gestacion ORDER BY ciclo_id, fecha DESC, id DESC
       )
       SELECT COUNT(*) AS total
       FROM ciclo_reproductivo cr
       JOIN ultimo_diagnostico ud ON ud.ciclo_id=cr.id AND ud.resultado='prenada'
       JOIN servicio_reproductivo sr ON sr.id=ud.servicio_id
       WHERE cr.fecha_cierre IS NULL
         AND COALESCE(sr.fecha_parto_estimada_ajustada, sr.fecha + $2::int)
             BETWEEN COALESCE($3::date, CURRENT_DATE) AND COALESCE($3::date, CURRENT_DATE) + $1::int`,
      [config.dias_alerta_parto, config.dias_gestacion_bovina, hoy]
    ),
    db.query(
      `SELECT COUNT(*) AS total FROM (
        SELECT c.id, c.capacidad_maxima, COUNT(a.id) AS ocupacion
        FROM corral c
        LEFT JOIN animal a ON a.corral_actual_id = c.id AND a.estado = 'vivo'
        GROUP BY c.id, c.capacidad_maxima
        HAVING COUNT(a.id)::float / NULLIF(c.capacidad_maxima, 0) >= $1::float / 100
      ) sub`,
      [config.pct_corral_casi_lleno]
    ),
    db.query(
      `SELECT COUNT(*) AS total FROM asignacion_tarea at
       JOIN trabajador t ON t.id = at.trabajador_id
       WHERE at.estado IN ('pendiente', 'en_progreso') ${soloTareasPropias ? 'AND t.usuario_id = $1' : ''}`,
      soloTareasPropias ? [usuario.id] : []
    ),
    db.query(
      `SELECT COUNT(*) AS total FROM (
        SELECT aps.animal_id, pi.id
        FROM animal_plan_sanitario aps
        JOIN plan_sanitario p ON p.id = aps.plan_id AND p.activo = true
        JOIN plan_sanitario_item pi ON pi.plan_id = p.id
        JOIN animal a ON a.id = aps.animal_id AND a.estado = 'vivo' AND a.fecha_nacimiento IS NOT NULL
        LEFT JOIN evento_salud es ON es.animal_id = aps.animal_id AND es.plan_item_id = pi.id
        WHERE es.id IS NULL
          AND a.fecha_nacimiento + (pi.edad_dias || ' days')::interval <= COALESCE($2::date, CURRENT_DATE) + $1::int
      ) sub`,
      [config.dias_alerta_vacuna, hoy]
    ),
  ]);

  return {
    vacunas_proximas: Number(vacunas.rows[0].total),
    stock_bajo: Number(stock.rows[0].total),
    partos_proximos: Number(partos.rows[0].total),
    corrales_casi_llenos: Number(corrales.rows[0].total),
    tareas_pendientes: Number(tareas.rows[0].total),
    plan_sanitario_pendiente: Number(planSanitario.rows[0].total),
  };
}

// Patrones del hato (GET /api/alertas/hato): posibles brotes por contacto,
// corrales con pesajes atrasados y mortalidad del mes frente al anterior.
async function obtenerAlertasHato(db, config) {
  const [clustersCrudos, pesajesAtrasados, mortalidad] = await Promise.all([
    calcularClustersContacto(config.dias_ventana_brote_ia),
    db.query(`
      SELECT c.id AS corral_id, c.nombre AS corral, COUNT(*) AS atrasados,
             (SELECT COUNT(*) FROM animal WHERE corral_actual_id = c.id AND estado = 'vivo') AS total_corral
      FROM animal a
      JOIN corral c ON c.id = a.corral_actual_id
      LEFT JOIN LATERAL (SELECT MAX(fecha) AS ultima FROM pesaje p WHERE p.animal_id = a.id) up ON true
      WHERE a.estado = 'vivo'
        AND (up.ultima IS NULL OR up.ultima < CURRENT_DATE - $1::int)
      GROUP BY c.id, c.nombre
      ORDER BY atrasados DESC
    `, [config.dias_sin_pesaje_alerta]),
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'muerto' AND date_trunc('month', fecha_baja) = date_trunc('month', CURRENT_DATE)) AS mes_actual,
        COUNT(*) FILTER (WHERE estado = 'muerto' AND date_trunc('month', fecha_baja) = date_trunc('month', CURRENT_DATE) - INTERVAL '1 month') AS mes_anterior
      FROM animal
    `),
  ]);

  const clustersEnriquecidos = await enriquecerClusters(clustersCrudos);
  // Solo interesan como "posible brote" los clústeres con suficientes afectados
  // (enfermos/en observación) — un clúster de animales todos sanos es solo
  // historial de movimientos, no una alerta.
  const clusters = clustersEnriquecidos
    .filter((c) => contarAfectados(c) >= config.min_afectados_cluster_brote)
    .sort((a, b) => contarAfectados(b) - contarAfectados(a));

  return {
    clusters,
    pesajes_atrasados: pesajesAtrasados.rows,
    mortalidad: {
      mes_actual: Number(mortalidad.rows[0].mes_actual),
      mes_anterior: Number(mortalidad.rows[0].mes_anterior),
    },
  };
}


module.exports = { obtenerResumenAlertas, obtenerAlertasHato, contarAfectados, ESTADOS_AFECTADO };
