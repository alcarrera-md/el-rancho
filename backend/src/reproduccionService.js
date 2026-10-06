const { conflicto, noEncontrado } = require('./errors');

function fechaISO(fecha) {
  return fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10);
}

async function configuracionNumerica(client, clave, respaldo) {
  const { rows } = await client.query('SELECT valor FROM configuracion WHERE clave = $1', [clave]);
  const valor = Number(rows[0]?.valor);
  return Number.isFinite(valor) ? valor : respaldo;
}

async function validarAnimalReproductivo(client, id, sexo, etiqueta) {
  const { rows } = await client.query('SELECT id, arete_id, sexo, estado, categoria, fecha_nacimiento FROM animal WHERE id = $1 FOR SHARE', [id]);
  const codigoNoDisponible = sexo === 'hembra' ? 'ANIMAL_REPRODUCTIVO_NO_DISPONIBLE' : 'MACHO_REPRODUCTIVO_NO_DISPONIBLE';
  if (!rows.length) throw noEncontrado(codigoNoDisponible, `${etiqueta} ya no está disponible.`);
  const animal = rows[0];
  if (animal.sexo !== sexo) throw conflicto('SEXO_REPRODUCTIVO_INVALIDO', `${etiqueta} debe ser ${sexo}.`);
  if (animal.estado !== 'vivo') throw conflicto(codigoNoDisponible, sexo === 'hembra' ? 'Este animal ya no está disponible para acciones reproductivas.' : 'El toro ya no está disponible para este servicio.');
  if (sexo === 'hembra' && !['vientre', 'reproductor'].includes(animal.categoria)) {
    throw conflicto(codigoNoDisponible, 'Este animal no pertenece a una categoría reproductiva operable.');
  }
  return animal;
}

async function validarResponsable(client, id) {
  if (!id) return;
  const { rowCount } = await client.query('SELECT id FROM trabajador WHERE id = $1 AND activo = true FOR SHARE', [id]);
  if (!rowCount) throw noEncontrado('RESPONSABLE_NO_ENCONTRADO', 'El responsable no existe o está inactivo.');
}

async function obtenerCicloBloqueado(client, cicloId) {
  const { rows } = await client.query('SELECT * FROM ciclo_reproductivo WHERE id = $1 FOR UPDATE', [cicloId]);
  if (!rows.length) throw noEncontrado('CICLO_REPRODUCTIVO_NO_ENCONTRADO', 'El ciclo reproductivo no existe.');
  return rows[0];
}

async function ultimoDiagnostico(client, cicloId) {
  const { rows } = await client.query(
    'SELECT * FROM diagnostico_gestacion WHERE ciclo_id = $1 ORDER BY fecha DESC, id DESC LIMIT 1',
    [cicloId]
  );
  return rows[0] || null;
}

async function crearServicio(client, datos) {
  const hembra = await validarAnimalReproductivo(client, datos.hembra_id, 'hembra', 'La hembra');
  if (hembra.fecha_nacimiento && datos.fecha < fechaISO(hembra.fecha_nacimiento)) {
    throw conflicto('FECHA_REPRODUCTIVA_INVALIDA', 'El servicio no puede ser anterior al nacimiento de la hembra.');
  }
  if (datos.macho_id) {
    if (Number(datos.macho_id) === Number(datos.hembra_id)) throw conflicto('PROGENITORES_IGUALES', 'La hembra y el macho no pueden ser el mismo animal.');
    const macho = await validarAnimalReproductivo(client, datos.macho_id, 'macho', 'El macho');
    if (macho.fecha_nacimiento && datos.fecha < fechaISO(macho.fecha_nacimiento)) {
      throw conflicto('FECHA_REPRODUCTIVA_INVALIDA', 'El servicio no puede ser anterior al nacimiento del macho.');
    }
  }
  await validarResponsable(client, datos.responsable_id);

  const abierto = await client.query(
    'SELECT * FROM ciclo_reproductivo WHERE hembra_id = $1 AND fecha_cierre IS NULL FOR UPDATE',
    [datos.hembra_id]
  );
  let ciclo = abierto.rows[0];
  if (ciclo) {
    const diagnostico = await ultimoDiagnostico(client, ciclo.id);
    if (diagnostico?.resultado === 'prenada') {
      throw conflicto('CICLO_YA_PRENADO', 'No se puede registrar otro servicio mientras exista una gestación confirmada.');
    }
    if (datos.fecha < fechaISO(ciclo.fecha_inicio)) throw conflicto('FECHA_REPRODUCTIVA_INVALIDA', 'El servicio no puede ser anterior al inicio del ciclo.');
  } else {
    const creado = await client.query(
      `INSERT INTO ciclo_reproductivo (hembra_id, fecha_inicio, observaciones, origen)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [datos.hembra_id, datos.fecha, datos.observaciones || null, datos.origen || 'manual']
    );
    ciclo = creado.rows[0];
  }

  const { rows } = await client.query(
    `INSERT INTO servicio_reproductivo
       (ciclo_id, fecha, tipo, macho_id, tipo_otro, responsable_id, observaciones,
        fecha_parto_estimada_ajustada, procedencia_fecha_parto_estimada, origen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [ciclo.id, datos.fecha, datos.tipo, datos.macho_id || null, datos.tipo_otro || null,
      datos.responsable_id || null, datos.observaciones || null,
      datos.fecha_parto_estimada_ajustada || null,
      datos.fecha_parto_estimada_ajustada ? 'manual' : null, datos.origen || 'manual']
  );
  return { ciclo, servicio: rows[0] };
}

async function registrarDiagnostico(client, cicloId, datos) {
  const ciclo = await obtenerCicloBloqueado(client, cicloId);
  if (ciclo.fecha_cierre) throw conflicto('CICLO_REPRODUCTIVO_CERRADO', 'El ciclo reproductivo ya está cerrado.');
  await validarAnimalReproductivo(client, ciclo.hembra_id, 'hembra', 'La hembra');
  if (datos.fecha < fechaISO(ciclo.fecha_inicio)) throw conflicto('FECHA_REPRODUCTIVA_INVALIDA', 'El diagnóstico no puede ser anterior al inicio del ciclo.');
  await validarResponsable(client, datos.responsable_id);

  let servicio = null;
  if (datos.servicio_id) {
    const consulta = await client.query('SELECT * FROM servicio_reproductivo WHERE id = $1 AND ciclo_id = $2 FOR SHARE', [datos.servicio_id, cicloId]);
    if (!consulta.rows.length) throw conflicto('SERVICIO_NO_PERTENECE_AL_CICLO', 'El servicio indicado no pertenece al ciclo.');
    servicio = consulta.rows[0];
  } else {
    const consulta = await client.query(
      'SELECT * FROM servicio_reproductivo WHERE ciclo_id = $1 AND fecha <= $2 ORDER BY fecha DESC, id DESC LIMIT 1',
      [cicloId, datos.fecha]
    );
    servicio = consulta.rows[0];
  }
  if (!servicio || datos.fecha < fechaISO(servicio.fecha)) throw conflicto('FECHA_REPRODUCTIVA_INVALIDA', 'El diagnóstico debe ser posterior a un servicio del ciclo.');

  const { rows } = await client.query(
    `INSERT INTO diagnostico_gestacion
       (ciclo_id, servicio_id, fecha, metodo, metodo_otro, resultado, responsable_id, observaciones, fecha_siguiente_revision, origen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [cicloId, servicio.id, datos.fecha, datos.metodo, datos.metodo_otro || null, datos.resultado,
      datos.responsable_id || null, datos.observaciones || null, datos.fecha_siguiente_revision || null, datos.origen || 'manual']
  );
  if (datos.resultado === 'vacia') {
    await client.query(
      `UPDATE ciclo_reproductivo SET fecha_cierre = $1, resultado_final = 'vacia' WHERE id = $2`,
      [datos.fecha, cicloId]
    );
  }
  return rows[0];
}

async function registrarParto(client, cicloId, datos) {
  const ciclo = await obtenerCicloBloqueado(client, cicloId);
  if (ciclo.fecha_cierre) throw conflicto('CICLO_REPRODUCTIVO_CERRADO', 'No se puede registrar un parto en un ciclo cerrado.');
  await validarAnimalReproductivo(client, ciclo.hembra_id, 'hembra', 'La hembra');
  if (datos.fecha_real < fechaISO(ciclo.fecha_inicio)) throw conflicto('FECHA_REPRODUCTIVA_INVALIDA', 'El parto o pérdida no puede ser anterior al inicio del ciclo.');
  await validarResponsable(client, datos.responsable_id);
  const diagnostico = await ultimoDiagnostico(client, cicloId);
  if (!diagnostico || diagnostico.resultado !== 'prenada') {
    throw conflicto('GESTACION_NO_CONFIRMADA', 'Se requiere un diagnóstico positivo vigente antes de registrar parto o pérdida.');
  }
  if (datos.fecha_real < fechaISO(diagnostico.fecha)) throw conflicto('FECHA_REPRODUCTIVA_INVALIDA', 'El parto o pérdida no puede ser anterior al diagnóstico positivo.');

  const { rows } = await client.query(
    `INSERT INTO parto_reproductivo
       (ciclo_id, fecha_real, resultado, incidencia, observaciones, responsable_id, origen)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [cicloId, datos.fecha_real, datos.resultado, datos.incidencia || null, datos.observaciones || null, datos.responsable_id || null, datos.origen || 'manual']
  );
  const parto = rows[0];
  const servicio = await client.query('SELECT * FROM servicio_reproductivo WHERE id = $1', [diagnostico.servicio_id]);
  const padreId = servicio.rows[0]?.macho_id || null;
  const crias = [];
  for (const cria of datos.crias) {
    if (cria.cria_id) {
      const animal = await client.query('SELECT * FROM animal WHERE id = $1 FOR UPDATE', [cria.cria_id]);
      if (!animal.rows.length) throw noEncontrado('CRIA_NO_ENCONTRADA', 'Una de las crías no existe.');
      if (animal.rows[0].estado !== 'vivo') throw conflicto('CRIA_NO_DISPONIBLE', 'La cría enlazada ya no está disponible.');
      if (Number(cria.cria_id) === Number(ciclo.hembra_id)) throw conflicto('CRIA_INVALIDA', 'La madre no puede registrarse como su propia cría.');
      if (animal.rows[0].madre_id && Number(animal.rows[0].madre_id) !== Number(ciclo.hembra_id)) throw conflicto('CRIA_CON_MADRE_DISTINTA', 'La cría ya tiene otra madre registrada.');
      if (animal.rows[0].fecha_nacimiento && fechaISO(animal.rows[0].fecha_nacimiento) !== datos.fecha_real) throw conflicto('FECHA_CRIA_INCONSISTENTE', 'La fecha de nacimiento de la cría no coincide con el parto.');
      await client.query(
        'UPDATE animal SET madre_id = $1, padre_id = COALESCE(padre_id, $2) WHERE id = $3',
        [ciclo.hembra_id, padreId, cria.cria_id]
      );
    }
    const insertada = await client.query(
      `INSERT INTO parto_cria (parto_id, cria_id, sexo_capturado, peso_kg, estado_nacimiento, incidencia)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [parto.id, cria.cria_id || null, cria.sexo_capturado || null, cria.peso_kg || null, cria.estado_nacimiento, cria.incidencia || null]
    );
    crias.push(insertada.rows[0]);
  }
  await client.query(
    `UPDATE ciclo_reproductivo SET fecha_cierre = $1, resultado_final = $2 WHERE id = $3`,
    [datos.fecha_real, datos.resultado === 'parto' ? 'parida' : 'perdida_aborto', cicloId]
  );
  return { parto, crias };
}

async function estadoDerivado(client, ciclo) {
  if (!ciclo) return { codigo: 'disponible', etiqueta: 'Disponible' };
  if (ciclo.fecha_cierre) {
    if (ciclo.resultado_final === 'parida') return { codigo: 'parida', etiqueta: 'Parida' };
    if (ciclo.resultado_final === 'vacia') return { codigo: 'vacia', etiqueta: 'Vacía' };
    if (ciclo.resultado_final === 'perdida_aborto') return { codigo: 'perdida_aborto', etiqueta: 'Pérdida/aborto' };
    return { codigo: 'cerrado', etiqueta: 'Ciclo cerrado' };
  }
  const diagnostico = await ultimoDiagnostico(client, ciclo.id);
  if (diagnostico?.resultado === 'dudoso') return { codigo: 'requiere_revision', etiqueta: 'Requiere revisión' };
  if (diagnostico?.resultado === 'prenada') {
    const servicio = await client.query('SELECT * FROM servicio_reproductivo WHERE id = $1', [diagnostico.servicio_id]);
    const diasGestacion = await configuracionNumerica(client, 'dias_gestacion_bovina', 283);
    const diasAlerta = await configuracionNumerica(client, 'dias_alerta_parto', 30);
    const s = servicio.rows[0];
    const estimada = s?.fecha_parto_estimada_ajustada || (s ? fechaISO(new Date(`${fechaISO(s.fecha)}T00:00:00Z`).getTime() + diasGestacion * 86400000) : null);
    const limite = fechaISO(new Date(Date.now() + diasAlerta * 86400000));
    return { codigo: estimada && estimada <= limite ? 'proxima_parto' : 'prenada', etiqueta: estimada && estimada <= limite ? 'Próxima a parto' : 'Preñada', fecha_parto_estimada: estimada, procedencia_fecha_parto_estimada: s?.fecha_parto_estimada_ajustada ? 'manual' : 'calculada' };
  }
  const ultimoServicio = await client.query('SELECT * FROM servicio_reproductivo WHERE ciclo_id = $1 ORDER BY fecha DESC, id DESC LIMIT 1', [ciclo.id]);
  const espera = await configuracionNumerica(client, 'dias_espera_diagnostico_gestacion', 35);
  const fechaPendiente = fechaISO(new Date(`${fechaISO(ultimoServicio.rows[0].fecha)}T00:00:00Z`).getTime() + espera * 86400000);
  return fechaISO(new Date()) >= fechaPendiente
    ? { codigo: 'pendiente_diagnostico', etiqueta: 'Pendiente de diagnóstico', fecha_diagnostico_sugerida: fechaPendiente }
    : { codigo: 'servida', etiqueta: 'Servida', fecha_diagnostico_sugerida: fechaPendiente };
}

async function cargarCiclo(client, ciclo) {
  const [servicios, diagnosticos, parto, crias] = await Promise.all([
    client.query(`SELECT sr.*, m.arete_id AS macho_arete, t.nombre AS responsable
                  FROM servicio_reproductivo sr LEFT JOIN animal m ON m.id=sr.macho_id LEFT JOIN trabajador t ON t.id=sr.responsable_id
                  WHERE sr.ciclo_id=$1 ORDER BY sr.fecha, sr.id`, [ciclo.id]),
    client.query(`SELECT dg.*, t.nombre AS responsable FROM diagnostico_gestacion dg LEFT JOIN trabajador t ON t.id=dg.responsable_id
                  WHERE dg.ciclo_id=$1 ORDER BY dg.fecha, dg.id`, [ciclo.id]),
    client.query('SELECT * FROM parto_reproductivo WHERE ciclo_id=$1', [ciclo.id]),
    client.query(`SELECT pc.* FROM parto_cria pc
                  JOIN parto_reproductivo pr ON pr.id=pc.parto_id
                  WHERE pr.ciclo_id=$1 ORDER BY pc.id`, [ciclo.id]),
  ]);
  const estado = await estadoDerivado(client, ciclo);
  return { ...ciclo, estado_actual: estado, gestacion_inferida_por_parto_historico: ciclo.origen === 'migracion_legado' && ciclo.resultado_final === 'parida' && diagnosticos.rows.length === 0, servicios: servicios.rows, diagnosticos: diagnosticos.rows, parto: parto.rows[0] || null, crias: crias.rows };
}

async function cargarHatoOperable(client) {
  const { rows: animales } = await client.query(`
    SELECT a.id, a.arete_id, a.nombre_alias, a.sexo, a.estado, a.categoria,
           c.nombre AS corral_actual
    FROM animal a
    LEFT JOIN corral c ON c.id=a.corral_actual_id
    WHERE a.estado='vivo' AND a.sexo='hembra' AND a.categoria IN ('vientre','reproductor')
    ORDER BY a.arete_id`);
  const resultado = [];
  for (const animal of animales) {
    const { rows } = await client.query(
      `SELECT cr.*, $2::text AS madre_arete, $3::text AS madre_nombre, $4::text AS madre_corral
       FROM ciclo_reproductivo cr WHERE cr.hembra_id=$1
       ORDER BY (cr.fecha_cierre IS NULL) DESC, cr.fecha_inicio DESC, cr.id DESC LIMIT 1`,
      [animal.id, animal.arete_id, animal.nombre_alias, animal.corral_actual]
    );
    resultado.push({ animal, ciclo: rows[0] ? await cargarCiclo(client, rows[0]) : null });
  }
  return resultado;
}

module.exports = { crearServicio, registrarDiagnostico, registrarParto, estadoDerivado, cargarCiclo, cargarHatoOperable, configuracionNumerica };
