// Snapshot de campo (GET /api/sync/bootstrap). Es una copia de lectura para
// trabajar sin conexión; el servidor sigue siendo la autoridad. Cada colección
// se arma con UNA consulta (subconsultas LATERAL acotadas por índice por
// animal), nunca con consultas por animal desde JS.

const ESQUEMA_BOOTSTRAP = 'offline-bootstrap.v5';
const SNAPSHOT_VERSION = 5;
const ROLES_CON_TAREAS_PROPIAS = new Set(['Veterinario', 'Trabajador']);

// Solo lo necesario para trabajo de campo; no historiales completos.
const LIMITES = Object.freeze({
  dias_bajas_recientes: 30, // animales vendidos/muertos/sacrificados visibles para explicar conflictos
  eventos_salud: 3,
  dias_eventos_salud: 180,
  proximas_dosis: 3,
  dias_dosis_vencidas: 14,
  dias_dosis_futuras: 60,
  notas: 3,
  dias_notas: 90,
  caracteres_nota: 280,
  caracteres_diagnostico: 200,
});

const SQL_ANIMALES = `
  SELECT a.id, a.arete_id, a.nombre_alias, a.sexo, a.categoria, a.version,
         a.estado, a.fecha_baja::text AS fecha_baja, a.estado_salud, a.salud_fecha_inicio::text AS salud_fecha_inicio,
         LEFT(a.salud_diagnostico, $1) AS salud_diagnostico,
         a.fecha_nacimiento, r.nombre AS raza,
         a.corral_actual_id, c.nombre AS corral, c.nombre AS corral_actual,
         ultimo.peso_kg AS ultimo_peso_kg, ultimo.fecha::text AS ultimo_peso_fecha,
         cc.puntuacion AS condicion_corporal, cc.fecha::text AS condicion_corporal_fecha,
         COALESCE(salud.eventos, '[]'::json) AS eventos_salud_recientes,
         COALESCE(dosis.proximas, '[]'::json) AS proximas_dosis,
         COALESCE(notas.recientes, '[]'::json) AS notas_recientes
  FROM animal a
  LEFT JOIN raza r ON r.id = a.raza_id
  LEFT JOIN corral c ON c.id = a.corral_actual_id
  LEFT JOIN LATERAL (
    SELECT p.peso_kg, p.fecha FROM pesaje p
    WHERE p.animal_id = a.id ORDER BY p.fecha DESC, p.id DESC LIMIT 1
  ) ultimo ON true
  LEFT JOIN LATERAL (
    SELECT x.puntuacion, x.fecha FROM condicion_corporal x
    WHERE x.animal_id = a.id ORDER BY x.fecha DESC, x.id DESC LIMIT 1
  ) cc ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('tipo', e.tipo, 'enfermedad', e.enfermedad, 'fecha', e.fecha) ORDER BY e.fecha DESC, e.id DESC) AS eventos
    FROM (
      SELECT id, tipo, enfermedad, fecha FROM evento_salud
      WHERE animal_id = a.id AND fecha >= CURRENT_DATE - $2::int
      ORDER BY fecha DESC, id DESC LIMIT $3
    ) e
  ) salud ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('tipo', d.tipo, 'enfermedad', d.enfermedad, 'fecha', d.proxima_dosis) ORDER BY d.proxima_dosis, d.id) AS proximas
    FROM (
      SELECT id, tipo, enfermedad, proxima_dosis FROM evento_salud
      WHERE animal_id = a.id AND proxima_dosis BETWEEN CURRENT_DATE - $4::int AND CURRENT_DATE + $5::int
      ORDER BY proxima_dosis, id LIMIT $6
    ) d
  ) dosis ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('tag', n.tag, 'contenido', n.contenido, 'fecha', n.fecha, 'autor', n.autor) ORDER BY n.fecha DESC, n.id DESC) AS recientes
    FROM (
      SELECT ns.id, ns.tag, LEFT(ns.contenido, $7) AS contenido, ns.fecha, u.nombre AS autor
      FROM nota_seguimiento ns LEFT JOIN usuario u ON u.id = ns.usuario_id
      WHERE ns.animal_id = a.id AND ns.fecha >= CURRENT_DATE - $8::int
      ORDER BY ns.fecha DESC, ns.id DESC LIMIT $9
    ) n
  ) notas ON true
  WHERE a.estado = 'vivo'
     OR (a.fecha_baja IS NOT NULL AND a.fecha_baja >= CURRENT_DATE - $10::int)
  ORDER BY a.arete_id, a.id`;

const SQL_CORRALES = `
  SELECT c.id, c.nombre, c.descripcion, c.ubicacion, c.capacidad_maxima, c.activo,
         t.nombre AS responsable,
         COUNT(a.id) FILTER (WHERE a.estado = 'vivo')::int AS ocupacion_actual,
         COUNT(a.id) FILTER (WHERE a.estado = 'vivo' AND a.estado_salud = 'sano')::int AS saludables,
         COUNT(a.id) FILTER (WHERE a.estado = 'vivo' AND a.estado_salud = 'observacion')::int AS en_observacion,
         COUNT(a.id) FILTER (WHERE a.estado = 'vivo' AND a.estado_salud = 'enfermo')::int AS enfermos,
         ROUND(AVG(ultimo.peso_kg) FILTER (WHERE a.estado = 'vivo'), 1) AS peso_promedio
  FROM corral c
  LEFT JOIN trabajador t ON t.id = c.trabajador_id
  LEFT JOIN animal a ON a.corral_actual_id = c.id AND a.estado = 'vivo'
  LEFT JOIN LATERAL (
    SELECT p.peso_kg FROM pesaje p
    WHERE p.animal_id = a.id ORDER BY p.fecha DESC, p.id DESC LIMIT 1
  ) ultimo ON true
  GROUP BY c.id, t.nombre
  ORDER BY c.nombre, c.id`;

const SQL_TAREAS = (filtro) => `
  SELECT a.id, a.titulo, a.descripcion, a.tipo, a.trabajador_id,
         t.nombre AS responsable, a.corral_id, principal.nombre AS corral,
         a.animal_id, an.arete_id AS animal_arete, an.nombre_alias AS animal_alias,
         i.nombre AS insumo, i.unidad_medida, a.cantidad, u.nombre AS creador,
         a.fecha AS fecha_limite, a.prioridad, a.estado, a.completado_en,
         a.actualizado_en, a.version,
         COALESCE(contexto.corrales, '[]'::json) AS corrales,
         COALESCE(contexto.corral_ids, ARRAY[]::int[]) AS corral_ids
  FROM asignacion_tarea a
  JOIN trabajador t ON t.id = a.trabajador_id
  LEFT JOIN corral principal ON principal.id = a.corral_id
  LEFT JOIN animal an ON an.id = a.animal_id
  LEFT JOIN insumo i ON i.id = a.insumo_id
  LEFT JOIN usuario u ON u.id = a.creador_usuario_id
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('id', cx.id, 'nombre', cx.nombre) ORDER BY cx.nombre) AS corrales,
           array_agg(cx.id ORDER BY cx.nombre) AS corral_ids
    FROM asignacion_tarea_corral ac
    JOIN corral cx ON cx.id = ac.corral_id
    WHERE ac.tarea_id = a.id
  ) contexto ON true
  ${filtro}
  ORDER BY a.fecha, a.id`;

const SQL_INSUMOS = `
  SELECT id, nombre, unidad_medida, stock_actual, fecha_caducidad, activo, version,
         CASE
           WHEN activo = false THEN 'inactivo'
           WHEN fecha_caducidad IS NOT NULL AND fecha_caducidad < CURRENT_DATE THEN 'caducado'
           WHEN stock_actual <= 0 THEN 'sin_stock'
           ELSE 'disponible'
         END AS estado
  FROM insumo
  WHERE tipo = 'alimento'
  ORDER BY nombre, id`;

// P8.3: catálogo mínimo para registrar vacunas y tratamientos sin conexión.
// Un evento sanitario no descuenta stock; solo se necesita saber qué insumo
// existe y si está vigente (el servidor rechaza uno caducado al sincronizar).
const SQL_INSUMOS_SANITARIOS = `
  SELECT id, nombre, tipo, unidad_medida, fecha_caducidad::text AS fecha_caducidad, activo,
         CASE
           WHEN activo = false THEN 'inactivo'
           WHEN fecha_caducidad IS NOT NULL AND fecha_caducidad < CURRENT_DATE THEN 'caducado'
           ELSE 'disponible'
         END AS estado
  FROM insumo
  WHERE tipo IN ('vacuna', 'medicamento') AND activo = true
  ORDER BY tipo, nombre, id`;

async function construirBootstrap(db, usuario) {
  const tareasPropias = ROLES_CON_TAREAS_PROPIAS.has(usuario.rol);
  const [reloj, identidad, animales, corrales, tareas, insumos, sanitarios] = await Promise.all([
    db.query('SELECT clock_timestamp() AS ahora'),
    db.query(
      `SELECT id, nombre FROM trabajador
       WHERE usuario_id = $1 AND activo = true ORDER BY id LIMIT 1`,
      [usuario.id]
    ),
    db.query(SQL_ANIMALES, [
      LIMITES.caracteres_diagnostico, LIMITES.dias_eventos_salud, LIMITES.eventos_salud,
      LIMITES.dias_dosis_vencidas, LIMITES.dias_dosis_futuras, LIMITES.proximas_dosis,
      LIMITES.caracteres_nota, LIMITES.dias_notas, LIMITES.notas, LIMITES.dias_bajas_recientes,
    ]),
    db.query(SQL_CORRALES),
    db.query(SQL_TAREAS(tareasPropias ? 'WHERE t.usuario_id = $1' : ''), tareasPropias ? [usuario.id] : []),
    db.query(SQL_INSUMOS),
    db.query(SQL_INSUMOS_SANITARIOS),
  ]);
  const generadoEn = reloj.rows[0].ahora;
  return {
    schema: ESQUEMA_BOOTSTRAP,
    snapshot_version: SNAPSHOT_VERSION,
    server_timestamp: generadoEn,
    generado_en: generadoEn,
    limites: LIMITES,
    partition: {
      usuario_id: usuario.id,
      sesion_version: usuario.sesion_version,
    },
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      sesion_version: usuario.sesion_version,
      trabajador: identidad.rows[0] || null,
    },
    animales: animales.rows,
    corrales: corrales.rows,
    tareas: tareas.rows,
    insumos: insumos.rows,
    insumos_sanitarios: sanitarios.rows,
  };
}

module.exports = { ESQUEMA_BOOTSTRAP, SNAPSHOT_VERSION, LIMITES, construirBootstrap };
