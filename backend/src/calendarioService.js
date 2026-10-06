// Calendario operativo: no tiene tabla propia. Reúne lo que ya tiene fecha en
// otros módulos (próximas dosis, partos estimados, tareas y actividades de plan
// sanitario sin aplicar). Lo usan la pantalla Calendario (routes/calendario.js)
// y el asistente, para que ambos muestren exactamente lo mismo.

const ROLES_TAREAS_PROPIAS = ['Veterinario', 'Trabajador'];

async function obtenerEventosCalendario(db, { desde, hasta, usuario }) {
  const soloTareasPropias = ROLES_TAREAS_PROPIAS.includes(usuario?.rol);

  const [vacunas, partos, tareas, planSanitario] = await Promise.all([
    db.query(
      `SELECT es.id, es.proxima_dosis AS fecha, es.tipo, es.enfermedad, a.id AS animal_id, a.arete_id, a.nombre_alias
       FROM evento_salud es JOIN animal a ON a.id = es.animal_id
       WHERE es.proxima_dosis BETWEEN $1 AND $2`,
      [desde, hasta]
    ),
    db.query(
      `WITH ultimo_diagnostico AS (
         SELECT DISTINCT ON (ciclo_id) ciclo_id, resultado, servicio_id
         FROM diagnostico_gestacion ORDER BY ciclo_id, fecha DESC, id DESC
       ), config AS (
         SELECT COALESCE((SELECT valor::int FROM configuracion WHERE clave='dias_gestacion_bovina'),283) dias
       )
       SELECT cr.id, COALESCE(sr.fecha_parto_estimada_ajustada, sr.fecha + config.dias) AS fecha,
              a.id AS animal_id, a.arete_id, a.nombre_alias
       FROM ciclo_reproductivo cr
       JOIN ultimo_diagnostico ud ON ud.ciclo_id=cr.id AND ud.resultado='prenada'
       JOIN servicio_reproductivo sr ON sr.id=ud.servicio_id
       JOIN animal a ON a.id=cr.hembra_id CROSS JOIN config
       WHERE cr.fecha_cierre IS NULL
         AND COALESCE(sr.fecha_parto_estimada_ajustada, sr.fecha + config.dias) BETWEEN $1 AND $2`,
      [desde, hasta]
    ),
    db.query(
      `SELECT at.id, at.fecha, at.descripcion, at.completada, t.nombre AS trabajador,
              string_agg(c.nombre, ', ' ORDER BY c.nombre) AS corrales
       FROM asignacion_tarea at JOIN trabajador t ON t.id = at.trabajador_id
       LEFT JOIN asignacion_tarea_corral ac ON ac.tarea_id = at.id
       LEFT JOIN corral c ON c.id = ac.corral_id
       WHERE at.fecha BETWEEN $1 AND $2 AND at.estado <> 'cancelada' ${soloTareasPropias ? 'AND t.usuario_id = $3' : ''}
       GROUP BY at.id, t.nombre`,
      soloTareasPropias ? [desde, hasta, usuario.id] : [desde, hasta]
    ),
    db.query(
      `SELECT aps.id, pi.nombre_evento, a.id AS animal_id, a.arete_id, a.nombre_alias,
              (a.fecha_nacimiento + (pi.edad_dias || ' days')::interval)::date AS fecha,
              es.id AS evento_salud_id
       FROM animal_plan_sanitario aps
       JOIN plan_sanitario p ON p.id = aps.plan_id AND p.activo = true
       JOIN plan_sanitario_item pi ON pi.plan_id = p.id
       JOIN animal a ON a.id = aps.animal_id
       LEFT JOIN evento_salud es ON es.animal_id = aps.animal_id AND es.plan_item_id = pi.id
       WHERE a.fecha_nacimiento IS NOT NULL
         AND (a.fecha_nacimiento + (pi.edad_dias || ' days')::interval)::date BETWEEN $1 AND $2`,
      [desde, hasta]
    ),
  ]);

  return [
    ...vacunas.rows.map((v) => ({ fecha: v.fecha, tipo: 'vacuna', titulo: `${v.tipo} — ${v.arete_id}`, animal_id: v.animal_id, arete_id: v.arete_id, nombre_alias: v.nombre_alias, evento: v.tipo, enfermedad: v.enfermedad })),
    ...partos.rows.map((p) => ({ fecha: p.fecha, tipo: 'parto', titulo: `Parto estimado — ${p.arete_id}`, animal_id: p.animal_id, arete_id: p.arete_id, nombre_alias: p.nombre_alias })),
    ...tareas.rows.map((t) => ({ fecha: t.fecha, tipo: 'tarea', titulo: t.descripcion, completada: t.completada, trabajador: t.trabajador, corral: t.corrales })),
    ...planSanitario.rows
      .filter((p) => !p.evento_salud_id)
      .map((p) => ({ fecha: p.fecha, tipo: 'plan_sanitario', titulo: `${p.nombre_evento} — ${p.arete_id}`, animal_id: p.animal_id, arete_id: p.arete_id, nombre_alias: p.nombre_alias })),
  ];
}

module.exports = { obtenerEventosCalendario };
