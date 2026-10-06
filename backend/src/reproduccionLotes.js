const crypto = require('crypto');
const { conflicto } = require('./errors');
const { crearServicio, registrarDiagnostico, registrarParto } = require('./reproduccionService');

const TIPOS_SERVICIO = new Set(['natural', 'inseminacion_artificial', 'otro']);
const METODOS = new Set(['palpacion', 'ecografia', 'otro']);
const RESULTADOS_DIAGNOSTICO = new Set(['prenada', 'vacia', 'dudoso']);
const RESULTADOS_PARTO = new Set(['parto', 'aborto', 'perdida']);

function texto(valor) { return valor === null || valor === undefined ? '' : String(valor).trim(); }
function canon(valor) {
  return texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s-]+/g, '_');
}
function fecha(valor) { return texto(valor).slice(0, 10); }
function fechaBD(valor) { return valor instanceof Date ? valor.toISOString().slice(0, 10) : fecha(valor); }
function esFecha(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [anio, mes, dia] = valor.split('-').map(Number); const fechaValor = new Date(Date.UTC(anio, mes - 1, dia));
  return fechaValor.getUTCFullYear() === anio && fechaValor.getUTCMonth() === mes - 1 && fechaValor.getUTCDate() === dia;
}
function huella(valor) { return crypto.createHash('sha256').update(JSON.stringify(valor)).digest('hex'); }

function normalizarFila(fila, tipoLote, modo) {
  const tipo = modo === 'importacion' ? 'historico' : tipoLote.replace(/s$/, '');
  return {
    fila: Number(fila.fila), tipo,
    arete_vaca: texto(fila.arete_vaca), arete_toro: texto(fila.arete_toro),
    fecha_servicio: fecha(fila.fecha_servicio || (tipo === 'servicio' ? fila.fecha : '')),
    tipo_servicio: canon(fila.tipo_servicio || (tipo === 'servicio' ? fila.tipo : '')),
    tipo_servicio_otro: texto(fila.tipo_servicio_otro),
    fecha_diagnostico: fecha(fila.fecha_diagnostico || (tipo === 'diagnostico' ? fila.fecha : '')),
    metodo: canon(fila.metodo), metodo_otro: texto(fila.metodo_otro),
    resultado_diagnostico: canon(fila.resultado_diagnostico || fila.resultado),
    fecha_parto: fecha(fila.fecha_parto || (tipo === 'parto' ? fila.fecha : '')),
    resultado_parto: canon(fila.resultado_parto || (tipo === 'parto' ? fila.resultado : '')),
    responsable_id: fila.responsable_id ? Number(fila.responsable_id) : null,
    observaciones: texto(fila.observaciones),
  };
}

function agregar(lista, codigo, mensaje, campo) { lista.push({ codigo, mensaje, ...(campo ? { campo } : {}) }); }

async function animalPorArete(client, arete) {
  if (!arete) return null;
  const { rows } = await client.query(
    'SELECT id,arete_id,nombre_alias,sexo,estado,categoria,fecha_nacimiento FROM animal WHERE arete_id=$1', [arete]
  );
  return rows[0] || null;
}

async function cicloAbierto(client, hembraId) {
  const { rows } = await client.query(
    `SELECT cr.*, (SELECT resultado FROM diagnostico_gestacion WHERE ciclo_id=cr.id ORDER BY fecha DESC,id DESC LIMIT 1) ultimo_resultado,
            (SELECT fecha FROM servicio_reproductivo WHERE ciclo_id=cr.id ORDER BY fecha DESC,id DESC LIMIT 1) ultima_fecha_servicio
     FROM ciclo_reproductivo cr WHERE hembra_id=$1 AND fecha_cierre IS NULL`, [hembraId]
  );
  return rows[0] || null;
}

async function existeEvento(client, fila, animal) {
  const encontrados = [];
  if (fila.fecha_servicio) {
    const q = await client.query(`SELECT 1 FROM servicio_reproductivo sr JOIN ciclo_reproductivo cr ON cr.id=sr.ciclo_id
      WHERE cr.hembra_id=$1 AND sr.fecha=$2 AND sr.tipo=$3 LIMIT 1`, [animal.id, fila.fecha_servicio, fila.tipo_servicio]);
    if (q.rowCount) encontrados.push('servicio');
  }
  if (fila.fecha_diagnostico) {
    const q = await client.query(`SELECT 1 FROM diagnostico_gestacion dg JOIN ciclo_reproductivo cr ON cr.id=dg.ciclo_id
      WHERE cr.hembra_id=$1 AND dg.fecha=$2 AND dg.resultado=$3 LIMIT 1`, [animal.id, fila.fecha_diagnostico, fila.resultado_diagnostico]);
    if (q.rowCount) encontrados.push('diagnóstico');
  }
  if (fila.fecha_parto) {
    const q = await client.query(`SELECT 1 FROM parto_reproductivo pr JOIN ciclo_reproductivo cr ON cr.id=pr.ciclo_id
      WHERE cr.hembra_id=$1 AND pr.fecha_real=$2 AND pr.resultado=$3 LIMIT 1`, [animal.id, fila.fecha_parto, fila.resultado_parto]);
    if (q.rowCount) encontrados.push('parto/pérdida');
  }
  return encontrados;
}

async function evaluarFila(client, fila, modo) {
  const errores = []; const advertencias = [];
  const animal = await animalPorArete(client, fila.arete_vaca);
  if (!fila.arete_vaca) agregar(errores, 'ARETE_OBLIGATORIO', 'Indica el arete de la vaca.', 'arete_vaca');
  else if (!animal) agregar(errores, 'ANIMAL_NO_ENCONTRADO', `No existe el arete ${fila.arete_vaca}.`, 'arete_vaca');
  else {
    if (animal.sexo !== 'hembra') agregar(errores, 'ANIMAL_NO_ES_HEMBRA', 'El animal no es hembra.');
    if (animal.estado !== 'vivo' || !['vientre', 'reproductor'].includes(animal.categoria)) {
      agregar(errores, 'ANIMAL_NO_OPERABLE', 'La hembra no está disponible para acciones reproductivas.');
    }
  }
  let toro = null;
  if (fila.responsable_id) {
    const responsable = await client.query('SELECT 1 FROM trabajador WHERE id=$1 AND activo=true', [fila.responsable_id]);
    if (!responsable.rowCount) agregar(errores, 'RESPONSABLE_INVALIDO', 'El responsable no existe o está inactivo.', 'responsable_id');
  }
  if (fila.arete_toro) {
    toro = await animalPorArete(client, fila.arete_toro);
    if (!toro) agregar(errores, 'TORO_NO_ENCONTRADO', `No existe el toro ${fila.arete_toro}.`, 'arete_toro');
    else if (toro.sexo !== 'macho' || toro.estado !== 'vivo') agregar(errores, 'TORO_INVALIDO', 'El toro no es un macho vivo disponible.', 'arete_toro');
    else if (animal && toro.id === animal.id) agregar(errores, 'PROGENITORES_IGUALES', 'La vaca y el toro no pueden ser el mismo animal.');
  } else if (fila.fecha_servicio) agregar(advertencias, 'TORO_NO_REGISTRADO', 'El servicio quedará sin toro registrado.');

  const ciclo = animal ? await cicloAbierto(client, animal.id) : null;
  const tieneServicio = Boolean(fila.fecha_servicio);
  const tieneDiagnostico = Boolean(fila.fecha_diagnostico);
  const tieneParto = Boolean(fila.fecha_parto);
  if (!tieneServicio && !tieneDiagnostico && !tieneParto) agregar(errores, 'FILA_SIN_EVENTOS', 'La fila no contiene ningún evento reproductivo.');

  if (tieneServicio) {
    if (!esFecha(fila.fecha_servicio)) agregar(errores, 'FECHA_SERVICIO_INVALIDA', 'La fecha de servicio no es válida.', 'fecha_servicio');
    else if (fila.fecha_servicio > new Date().toISOString().slice(0, 10)) agregar(errores, 'FECHA_FUTURA', 'La fecha de servicio no puede ser futura.', 'fecha_servicio');
    if (!TIPOS_SERVICIO.has(fila.tipo_servicio)) agregar(errores, 'TIPO_SERVICIO_INVALIDO', 'Indica el tipo de servicio.', 'tipo_servicio');
    if (fila.tipo_servicio === 'otro' && !fila.tipo_servicio_otro) agregar(errores, 'TIPO_SERVICIO_INCOMPLETO', 'Describe el otro tipo de servicio.');
    if (ciclo?.ultimo_resultado === 'prenada') agregar(errores, 'CICLO_YA_PRENADO', 'La vaca ya tiene una gestación confirmada.');
  }
  if (tieneDiagnostico) {
    if (!esFecha(fila.fecha_diagnostico)) agregar(errores, 'FECHA_DIAGNOSTICO_INVALIDA', 'La fecha de diagnóstico no es válida.', 'fecha_diagnostico');
    else if (fila.fecha_diagnostico > new Date().toISOString().slice(0, 10)) agregar(errores, 'FECHA_FUTURA', 'La fecha de diagnóstico no puede ser futura.', 'fecha_diagnostico');
    if (!METODOS.has(fila.metodo)) agregar(errores, 'METODO_FALTANTE', 'Indica el método; no se asignará uno automáticamente.', 'metodo');
    if (fila.metodo === 'otro' && !fila.metodo_otro) agregar(errores, 'METODO_INCOMPLETO', 'Describe el otro método.');
    if (!RESULTADOS_DIAGNOSTICO.has(fila.resultado_diagnostico)) agregar(errores, 'RESULTADO_DIAGNOSTICO_INVALIDO', 'Indica Preñada, Vacía o Dudosa.', 'resultado_diagnostico');
    if (!tieneServicio && !ciclo) agregar(errores, 'CICLO_SIN_SERVICIO', 'No existe un ciclo abierto con servicio para este diagnóstico.');
  }
  if (tieneParto) {
    if (!esFecha(fila.fecha_parto)) agregar(errores, 'FECHA_PARTO_INVALIDA', 'La fecha de parto o pérdida no es válida.', 'fecha_parto');
    else if (fila.fecha_parto > new Date().toISOString().slice(0, 10)) agregar(errores, 'FECHA_FUTURA', 'La fecha de parto o pérdida no puede ser futura.', 'fecha_parto');
    if (!RESULTADOS_PARTO.has(fila.resultado_parto)) agregar(errores, 'RESULTADO_PARTO_INVALIDO', 'Indica Parto, Aborto o Pérdida.', 'resultado_parto');
    if (!tieneServicio && !ciclo) agregar(errores, 'CICLO_NO_ENCONTRADO', 'No existe un ciclo compatible para el parto.');
    const positiva = fila.resultado_diagnostico === 'prenada' || ciclo?.ultimo_resultado === 'prenada';
    if (!positiva && modo !== 'importacion') agregar(errores, 'GESTACION_NO_CONFIRMADA', 'Se requiere diagnóstico positivo antes del parto.');
    if (!positiva && modo === 'importacion') agregar(advertencias, 'DIAGNOSTICO_HISTORICO_AUSENTE', 'Se conservará servicio + parto como evidencia histórica, sin inventar diagnóstico.');
  }
  if (tieneServicio && tieneDiagnostico && fila.fecha_diagnostico < fila.fecha_servicio) agregar(errores, 'CRONOLOGIA_INVALIDA', 'El diagnóstico es anterior al servicio.');
  if (tieneDiagnostico && tieneParto && fila.fecha_parto < fila.fecha_diagnostico) agregar(errores, 'CRONOLOGIA_INVALIDA', 'El parto o pérdida es anterior al diagnóstico.');
  if (tieneServicio && tieneParto && fila.fecha_parto < fila.fecha_servicio) agregar(errores, 'CRONOLOGIA_INVALIDA', 'El parto o pérdida es anterior al servicio.');
  if (fila.resultado_diagnostico === 'vacia' && tieneParto) agregar(errores, 'SECUENCIA_INCOMPATIBLE', 'Una fila diagnosticada Vacía no puede incluir parto.');
  if (animal?.fecha_nacimiento && tieneServicio && fila.fecha_servicio < fechaBD(animal.fecha_nacimiento)) agregar(errores, 'FECHA_ANTES_NACIMIENTO', 'El servicio es anterior al nacimiento de la vaca.');

  const duplicadosBase = animal ? await existeEvento(client, fila, animal) : [];
  if (duplicadosBase.length) agregar(errores, 'DUPLICADO_BASE', `Ya existe un evento equivalente: ${duplicadosBase.join(', ')}.`);
  return { animal, toro, ciclo, errores, advertencias };
}

async function analizarLote(client, payload) {
  const normalizadas = payload.filas.map((fila) => normalizarFila(fila, payload.tipo_lote, payload.modo));
  const vistas = []; const huellas = new Map(); const firmasEvento = new Map();
  for (const fila of normalizadas) {
    const { fila: numeroFila, ...contenidoNormalizado } = fila;
    const hash = huella(contenidoNormalizado);
    const evaluacion = await evaluarFila(client, fila, payload.modo);
    if (huellas.has(hash)) agregar(evaluacion.errores, 'DUPLICADO_ARCHIVO', `Duplica la fila ${huellas.get(hash)} del mismo lote.`);
    else huellas.set(hash, fila.fila);
    const firmas = [
      fila.fecha_servicio && `servicio|${fila.arete_vaca}|${fila.fecha_servicio}`,
      fila.fecha_diagnostico && `diagnostico|${fila.arete_vaca}|${fila.fecha_diagnostico}`,
      fila.fecha_parto && `parto|${fila.arete_vaca}|${fila.fecha_parto}`,
    ].filter(Boolean);
    for (const firma of firmas) {
      if (firmasEvento.has(firma) && !evaluacion.errores.some((e) => e.codigo === 'DUPLICADO_ARCHIVO')) {
        agregar(evaluacion.errores, 'EVENTO_SIMILAR_ARCHIVO', `Existe un evento muy similar en la fila ${firmasEvento.get(firma)}.`);
      } else firmasEvento.set(firma, fila.fila);
    }
    if (payload.modo === 'importacion') {
      const repetida = await client.query('SELECT import_batch_id,numero_fila FROM reproduccion_import_fila WHERE huella=$1', [hash]);
      if (repetida.rowCount) agregar(evaluacion.errores, 'DUPLICADO_IMPORTADO', 'Esta fila ya fue importada anteriormente.');
    }
    vistas.push({ fila: fila.fila, datos: fila, huella: hash, errores: evaluacion.errores, advertencias: evaluacion.advertencias });
  }
  const resumen = {
    total: vistas.length,
    validas: vistas.filter((f) => !f.errores.length && !f.advertencias.length).length,
    advertencias: vistas.filter((f) => !f.errores.length && f.advertencias.length).length,
    errores: vistas.filter((f) => f.errores.length).length,
    duplicados: vistas.filter((f) => f.errores.some((e) => e.codigo.startsWith('DUPLICADO') || e.codigo === 'EVENTO_SIMILAR_ARCHIVO')).length,
  };
  return { import_batch_id: payload.import_batch_id, resumen, filas: vistas, puede_confirmar: resumen.errores === 0 };
}

async function registrarPartoHistorico(client, ciclo, fila, responsableId) {
  const { rows } = await client.query(
    `INSERT INTO parto_reproductivo (ciclo_id,fecha_real,resultado,observaciones,responsable_id,origen)
     VALUES ($1,$2,$3,$4,$5,'importacion_excel') RETURNING *`,
    [ciclo.id, fila.fecha_parto, fila.resultado_parto, fila.observaciones || null, responsableId]
  );
  await client.query(`UPDATE ciclo_reproductivo SET fecha_cierre=$1,resultado_final=$2 WHERE id=$3`,
    [fila.fecha_parto, fila.resultado_parto === 'parto' ? 'parida' : 'perdida_aborto', ciclo.id]);
  return { parto: rows[0], crias: [] };
}

async function aplicarFila(client, fila, modo) {
  const animal = await animalPorArete(client, fila.arete_vaca);
  const toro = fila.arete_toro ? await animalPorArete(client, fila.arete_toro) : null;
  const origen = modo === 'importacion' ? 'importacion_excel' : 'captura_masiva';
  let ciclo = await cicloAbierto(client, animal.id); const creados = {};
  if (fila.fecha_servicio) {
    const resultado = await crearServicio(client, {
      hembra_id: animal.id, macho_id: toro?.id, fecha: fila.fecha_servicio,
      tipo: fila.tipo_servicio, tipo_otro: fila.tipo_servicio_otro || null,
      responsable_id: fila.responsable_id, observaciones: fila.observaciones || null, origen,
    });
    ciclo = resultado.ciclo; creados.servicio = resultado.servicio;
  }
  if (fila.fecha_diagnostico) {
    creados.diagnostico = await registrarDiagnostico(client, ciclo.id, {
      fecha: fila.fecha_diagnostico, metodo: fila.metodo, metodo_otro: fila.metodo_otro || null,
      resultado: fila.resultado_diagnostico, responsable_id: fila.responsable_id,
      observaciones: fila.observaciones || null, origen,
    });
  }
  if (fila.fecha_parto) {
    const positiva = fila.resultado_diagnostico === 'prenada' || ciclo.ultimo_resultado === 'prenada';
    creados.parto = modo === 'importacion' && !positiva
      ? await registrarPartoHistorico(client, ciclo, fila, fila.responsable_id)
      : await registrarParto(client, ciclo.id, {
        fecha_real: fila.fecha_parto, resultado: fila.resultado_parto,
        responsable_id: fila.responsable_id, observaciones: fila.observaciones || null,
        crias: [], origen,
      });
  }
  return { animal_id: animal.id, ciclo_id: ciclo.id, ...creados };
}

async function aplicarLote(client, payload) {
  const huellaArchivo = huella(payload.filas.map((entrada) => {
    const normalizada = normalizarFila(entrada, payload.tipo_lote, payload.modo);
    const { fila: _fila, ...contenido } = normalizada;
    return huella(contenido);
  }));
  if (payload.modo === 'importacion') {
    const existente = await client.query('SELECT * FROM reproduccion_import_batch WHERE id=$1', [payload.import_batch_id]);
    if (existente.rowCount) {
      if (existente.rows[0].archivo_hash !== huellaArchivo) throw conflicto('IMPORT_BATCH_REUTILIZADO', 'El identificador de importación ya pertenece a otro contenido.');
      return { import_batch_id: payload.import_batch_id, repetido: true, total: existente.rows[0].total_filas };
    }
  }
  const analisis = await analizarLote(client, payload);
  if (!analisis.puede_confirmar) throw conflicto('LOTE_REPRODUCTIVO_INVALIDO', 'Corrige los errores antes de confirmar el lote.', { details: analisis });
  const resultados = [];
  for (const vista of analisis.filas) resultados.push(await aplicarFila(client, vista.datos, payload.modo));
  if (payload.modo === 'importacion') {
    await client.query(`INSERT INTO reproduccion_import_batch
      (id,archivo_hash,nombre_archivo,mapeo,usuario_id,total_filas) VALUES ($1,$2,$3,$4,$5,$6)`,
    [payload.import_batch_id, huellaArchivo, payload.nombre_archivo || null, payload.mapeo || {}, payload.usuario_id, resultados.length]);
    for (let i = 0; i < analisis.filas.length; i += 1) {
      const vista = analisis.filas[i];
      await client.query(`INSERT INTO reproduccion_import_fila
        (import_batch_id,numero_fila,huella,datos_normalizados,resultado) VALUES ($1,$2,$3,$4,$5)`,
      [payload.import_batch_id, vista.fila, vista.huella, vista.datos, resultados[i]]);
    }
  }
  return { import_batch_id: payload.import_batch_id, repetido: false, total: resultados.length, resultados };
}

module.exports = { normalizarFila, analizarLote, aplicarLote, huella };
