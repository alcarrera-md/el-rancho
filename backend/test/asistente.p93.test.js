const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATALOGO, conversarConsultivo, clasificarConsultaDeterminista, clasificarDegradado, accionesDesdeConsultas,
} = require('../src/asistenteConsultivo');
const { firmarContexto, verificarContexto } = require('../src/asistenteContexto');
const { POLITICA_PRIORIDAD, cruzarAnimales, obtenerResumenOperativo } = require('../src/asistenteCompuestoService');
const { SEVERIDAD_ALERTA } = require('../src/asistenteSaludService');

const admin = { id: 1, rol: 'Administrador' };
const telemetria = () => {};
const ahora = new Date('2026-09-30T12:00:00-06:00');
const sinGemini = async () => assert.fail('no debe llamar a Gemini');
const clasificar = (texto) => clasificarConsultaDeterminista(texto, ahora);

function conEjecutor(nombre, ejecutar) {
  const original = CATALOGO[nombre].ejecutar;
  CATALOGO[nombre].ejecutar = ejecutar;
  return () => { CATALOGO[nombre].ejecutar = original; };
}

function contextoDe(respuesta) {
  return verificarContexto(firmarContexto(respuesta._contexto, admin), admin);
}

function incluye(actual, esperado, mensaje) {
  assert.deepEqual(Object.fromEntries(Object.keys(esperado).map((clave) => [clave, actual[clave]])), esperado, mensaje);
}

const motivo = (tipo, prioridad, extra = {}) => ({ tipo, prioridad, detalle: null, fecha: null, extra: null, ...extra });
const atencionFalsa = (args = {}) => ({
  fecha_corte: '2026-09-30', criterio: 'Criterio.', filtros: { ...(args.sexo ? { sexo: args.sexo } : {}), ...(args.etapa ? { etapa: args.etapa } : {}) },
  resumen: { animales: 2, por_prioridad: { alta: 1, media: 1, baja: 0 }, enfermos: 0, en_observacion: 1, con_tarea_vencida: 1 },
  mostrados: 2, truncado: false,
  items: [
    { id: 22, arete_id: 'MX-7002', nombre_alias: 'Julio', prioridad: 'alta', fecha_clave: '2026-09-20', total_motivos: 1,
      motivos: [motivo('tarea_vencida', 'alta', { detalle: 'Revisar cojera', fecha: '2026-09-20', extra: 'sanitaria' })] },
    { id: 11, arete_id: 'MX-4003', nombre_alias: 'Estrella', prioridad: 'media', fecha_clave: '2026-09-10', total_motivos: 3,
      motivos: [motivo('observacion', 'media', { fecha: '2026-09-10' }), motivo('condicion_baja', 'media', { detalle: '2' }), motivo('tarea_hoy', 'media', { detalle: 'Pesar', fecha: '2026-09-30' })] },
  ],
});

test('P9.3 clasificador: consultas compuestas frecuentes sin Gemini y con argumentos válidos', () => {
  const casos = [
    ['¿Cómo va el rancho hoy?', 'consultar_resumen_operativo', {}],
    ['¿Qué animales necesitan atención?', 'consultar_atencion', {}],
    ['¿Qué debería revisar primero?', 'consultar_atencion', { limite: 5 }],
    ['¿Qué animales enfermos tienen tareas vencidas?', 'cruzar_animales', { criterios: ['enfermo', 'tarea_vencida'] }],
    ['¿Qué vacas preñadas están en observación?', 'cruzar_animales', { criterios: ['prenada', 'observacion'], sexo: 'hembra', etapa: 'adulto' }],
    ['¿Qué animales han bajado de peso y están enfermos?', 'cruzar_animales', { criterios: ['bajo_peso', 'enfermo'] }],
    ['¿Qué animales con condición corporal baja están en observación?', 'cruzar_animales', { criterios: ['condicion_baja', 'observacion'] }],
    ['¿Qué corrales tienen animales enfermos?', 'cruzar_animales', { criterios: ['enfermo'], agrupar_por: 'corral' }],
    ['¿Qué corral tiene más animales en observación?', 'cruzar_animales', { criterios: ['observacion'], agrupar_por: 'corral' }],
    ['¿Qué preñadas tienen tareas pendientes?', 'cruzar_animales', { criterios: ['prenada', 'tarea_pendiente'], sexo: 'hembra' }],
    ['¿Hay vacas preñadas enfermas?', 'cruzar_animales', { criterios: ['prenada', 'enfermo'] }],
    ['¿Qué vacas próximas a parto están en observación?', 'cruzar_animales', { criterios: ['proxima_parto', 'observacion'] }],
    ['¿Qué vacas preñadas tienen condición baja?', 'cruzar_animales', { criterios: ['prenada', 'condicion_baja'] }],
    ['¿Qué animales con dosis vencidas están en observación?', 'cruzar_animales', { criterios: ['dosis_vencida', 'observacion'] }],
    ['¿Cuántos animales con problemas hay por corral?', 'cruzar_animales', { criterios: ['problema_salud'], agrupar_por: 'corral' }],
    ['¿Qué corral tiene más tareas vencidas asociadas a animales?', 'cruzar_animales', { criterios: ['tarea_vencida'], ordenar_por: 'tareas' }],
    // Sin acentos y con letras intercambiadas.
    ['que animales enfermos tienen tareas vecnidas', 'cruzar_animales', { criterios: ['enfermo', 'tarea_vencida'] }],
    ['Que vacas prenadas estan en obsevracion', 'cruzar_animales', { criterios: ['prenada', 'observacion'] }],
  ];
  for (const [pregunta, tool, esperado] of casos) {
    const r = clasificar(pregunta);
    assert.equal(r?.tool, tool, pregunta);
    incluye(r.argumentos, esperado, pregunta);
    assert.equal(CATALOGO[tool].schema.safeParse(r.argumentos).success, true, pregunta);
  }
  // Falsos positivos: cualquier palabra fuera de la gramática va a Gemini.
  for (const ambigua of ['¿Qué toros preñados están enfermos?', '¿Qué vacas preñadas comen bien?', '¿Qué opinas del rancho?', '¿Qué animales enfermos y en observación hay?', '¿Qué vacas preñadas están en el corral Norte?']) {
    assert.equal(clasificar(ambigua), null, ambigua);
  }
});

test('P9.3 política: cada prioridad deriva de una regla existente y coincide con la severidad de Alertas', () => {
  const mapa = { critica: 'alta', advertencia: 'media' };
  assert.equal(POLITICA_PRIORIDAD.enfermo.prioridad, mapa[SEVERIDAD_ALERTA['Estado de salud']]);
  assert.equal(POLITICA_PRIORIDAD.observacion.prioridad, mapa[SEVERIDAD_ALERTA['Seguimiento de salud']]);
  assert.equal(POLITICA_PRIORIDAD.dosis_vencida.prioridad, mapa[SEVERIDAD_ALERTA['Vacuna vencida']]);
  assert.equal(POLITICA_PRIORIDAD.dosis_proxima.prioridad, mapa[SEVERIDAD_ALERTA['Vacuna próxima']]);
  assert.equal(POLITICA_PRIORIDAD.parto_proximo.prioridad, mapa[SEVERIDAD_ALERTA['Parto próximo']]);
  for (const [clave, regla] of Object.entries(POLITICA_PRIORIDAD)) assert.ok(regla.regla.length > 10, clave);
  assert.equal('bajo_peso' in POLITICA_PRIORIDAD, false, 'la pérdida de peso no tiene severidad definida: no prioriza');
});

test('P9.3 atención: un renglón por animal con todos sus motivos y el resumen por prioridad', async () => {
  const restaurar = conEjecutor('consultar_atencion', async (_db, args) => atencionFalsa(args));
  try {
    const r = await conversarConsultivo({ mensaje: '¿Qué animales necesitan atención?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(r.texto, 'Hay 2 animales que requieren atención: 1 con prioridad alta, 1 con prioridad media.');
    assert.deepEqual(r.lista, [
      'Julio (#MX-7002) · alta — tarea sanitaria vencida: Revisar cojera',
      'Estrella (#MX-4003) · media · 3 motivos — en observación; condición corporal baja (2/5); tarea para hoy: Pesar (30/09/2026)',
    ]);
    assert.match(r.advertencia, /Orden: prioridad, fecha de vencimiento y arete/);
    assert.deepEqual(r.acciones.map((a) => a.ruta), ['/alertas', '/tareas']);
  } finally { restaurar(); }
});

test('P9.3 "¿qué debería revisar primero?" usa solo la política y explica la regla', async () => {
  const restaurar = conEjecutor('consultar_atencion', async (_db, args) => atencionFalsa(args));
  try {
    const r = await conversarConsultivo({ mensaje: '¿Qué debería revisar primero?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(r.texto, 'Según las prioridades configuradas en El Rancho, lo primero para revisar es:');
    assert.deepEqual(r.lista, [
      '1. Julio (#MX-7002) — tarea sanitaria vencida: Revisar cojera (prioridad alta)',
      '2. Estrella (#MX-4003) — en observación (prioridad media; 3 motivos)',
    ]);
    assert.match(r.advertencia, /^Julio aparece primero con prioridad alta por la regla: tarea vencida: alta si es sanitaria/);
    // Sin veredictos propios: "urgente" solo puede aparecer citando la prioridad capturada en la tarea.
    assert.doesNotMatch(JSON.stringify(r), /recomiendo|es urgente|deberías/i);
  } finally { restaurar(); }
});

test('P9.3 cruces y corrales: resumen corto, detalle verificable, empates y cero resultados', async () => {
  let respuesta = null;
  const restaurar = conEjecutor('cruzar_animales', async (_db, args) => respuesta(args));
  try {
    respuesta = (args) => ({ criterios: args.criterios, descripcion: ['preñadas', 'en observación'], filtros: { sexo: 'hembra', etapa: 'adulto' }, criterio: 'Criterio.', total: 1, hembras: 1, machos: 0, mostrados: 1, truncado: false,
      items: [{ id: 11, arete_id: 'MX-4003', nombre_alias: 'Estrella', estado_salud: 'observacion', corral: 'Vientres', parto_estimado: '2026-10-20' }] });
    const cruce = await conversarConsultivo({ mensaje: '¿Qué vacas preñadas están en observación?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(cruce.texto, 'Hay 1 vacas preñadas y en observación.');
    assert.deepEqual(cruce.lista, ['Estrella (#MX-4003) · Vientres · en observación · parto estimado 20/10/2026']);
    assert.deepEqual(cruce.acciones.map((a) => a.ruta), ['/animales/11/seguimiento', '/reproduccion']);

    respuesta = (args) => ({ criterios: args.criterios, descripcion: ['en observación'], filtros: {}, criterio: 'Criterio.', agrupado_por: 'corral', total_animales: 4, total_corrales: 2,
      corrales: [{ corral_id: 1, corral: 'Norte', capacidad_maxima: 10, animales: 2, vivos_en_corral: 8 }, { corral_id: 2, corral: 'Sur', capacidad_maxima: null, animales: 2, vivos_en_corral: 3 }],
      mayor: [{ corral: 'Norte', corral_id: 1, valor: 2 }, { corral: 'Sur', corral_id: 2, valor: 2 }] });
    const mayor = await conversarConsultivo({ mensaje: '¿Qué corral tiene más animales en observación?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(mayor.texto, 'Hay un empate con 2 animal(es): Norte, Sur.');
    const corrales = await conversarConsultivo({ mensaje: '¿Qué corrales tienen animales en observación?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(corrales.texto, '2 corral(es) tienen animales en observación (4 en total).');
    assert.deepEqual(corrales.tabla.filas, [['Norte', '2', '8'], ['Sur', '2', '3']]);

    respuesta = (args) => ({ criterios: args.criterios, descripcion: ['enfermos', 'con tareas vencidas'], filtros: {}, criterio: 'Criterio.', total: 0, mostrados: 0, items: [] });
    const vacio = await conversarConsultivo({ mensaje: '¿Qué animales enfermos tienen tareas vencidas?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(vacio.texto, 'No hay animales enfermos y con tareas vencidas.');
    assert.deepEqual(vacio.acciones, []);
  } finally { restaurar(); }
});

test('P9.3 resumen operativo: corto, verificable y sin finanzas', async () => {
  const restaurar = conEjecutor('consultar_resumen_operativo', async () => ({
    fecha: '2026-09-30', criterio: 'Resumen de registros actuales.',
    secciones: {
      animales: { vivos: 26, enfermos: 2, en_observacion: 2 }, tareas: { vencidas: 1, hoy: 3 }, calendario_hoy: { total: 2, por_tipo: { tarea: 2 } },
      dosis: { vencidas: 1, proximas: 4, dias_umbral: 30 }, alertas: { tipos: 3, por_severidad: { critica: 1, advertencia: 2, info: 0 } },
      atencion: { animales: 5, por_prioridad: { alta: 2, media: 3, baja: 0 } }, reproduccion: { prenadas: 8, partos_proximos: 2, dias_umbral: 30 },
      inventario: { agotados: 0, en_o_bajo_minimo: 1 }, movimientos_7_dias: 4,
    },
  }));
  try {
    const r = await conversarConsultivo({ mensaje: '¿Cómo va el rancho hoy?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(r.texto, 'Hoy hay 26 animales vivos. 2 están enfermos y 2 en observación. Hay 1 tarea(s) vencida(s) y 2 evento(s) programado(s) para hoy.');
    assert.ok(r.lista.includes('Atención: 5 animal(es) (2 alta, 3 media, 0 baja)'));
    assert.doesNotMatch(JSON.stringify(r), /venta|gasto|utilidad|rentabilidad|\$/i);
    assert.deepEqual(r.acciones.map((a) => a.ruta), ['/alertas', '/tareas', '/calendario']);
  } finally { restaurar(); }
});

test('P9.3 contexto: atención → vacas → corral; corrales → ¿cuál tiene más?; cruce → + tareas pendientes', async () => {
  const atencion = [];
  const cruces = [];
  const restaurarA = conEjecutor('consultar_atencion', async (_db, args) => { atencion.push(args); return atencionFalsa(args); });
  const restaurarC = conEjecutor('cruzar_animales', async (_db, args) => {
    cruces.push(args);
    return args.agrupar_por
      ? { criterios: args.criterios, descripcion: ['enfermos'], filtros: {}, criterio: 'c', agrupado_por: 'corral', total_animales: 3, total_corrales: 2, corrales: [{ corral: 'Norte', animales: 2, vivos_en_corral: 5 }, { corral: 'Sur', animales: 1, vivos_en_corral: 2 }], mayor: [{ corral: 'Norte', valor: 2 }] }
      : { criterios: args.criterios, descripcion: ['preñadas'], filtros: {}, criterio: 'c', total: 1, mostrados: 1, items: [{ id: 11, arete_id: 'MX-4003', estado_salud: 'observacion' }] };
  });
  const preguntar = (mensaje, previa) => conversarConsultivo({ mensaje, contexto: previa ? contextoDe(previa) : null, usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
  try {
    const r1 = await preguntar('¿Qué animales necesitan atención?');
    const r2 = await preguntar('¿Y cuáles son vacas?', r1);
    const r3 = await preguntar('¿Y cuáles están en Corral Vientres?', r2);
    incluye(atencion[1], { sexo: 'hembra', etapa: 'adulto' });
    incluye(atencion[2], { sexo: 'hembra', etapa: 'adulto', corral: 'corral vientres' });
    assert.ok(r3.texto);
    const c1 = await preguntar('¿Qué corrales tienen animales enfermos?');
    const c2 = await preguntar('¿Y cuál tiene más?', c1);
    assert.equal(c2.texto, 'El corral con más es Norte: 2 animal(es).');
    const p1 = await preguntar('¿Qué vacas preñadas están en observación?');
    await preguntar('¿Y cuáles tienen tareas pendientes?', p1);
    assert.deepEqual(cruces.at(-1).criterios, ['prenada', 'observacion', 'tarea_pendiente']);
  } finally { restaurarA(); restaurarC(); }
});

test('P9.3 degradación: 429/503/timeout con fast path o módulo único responde con datos', async () => {
  const restaurar = conEjecutor('consultar_atencion', async (_db, args) => atencionFalsa(args));
  try {
    for (const code of ['GEMINI_RATE_LIMIT', 'GEMINI_SERVICE_UNAVAILABLE', 'GEMINI_TIMEOUT']) {
      const r = await conversarConsultivo({ mensaje: '¿Qué es lo más urgente en el rancho ahora mismo?', usuario: admin, db: {}, ahora, telemetria, gemini: async () => { throw Object.assign(new Error('x'), { code }); } });
      assert.match(r.texto, /Hay 2 animales que requieren atención/, code);
      assert.match(r.advertencia, /consulta de atención más cercana/);
    }
  } finally { restaurar(); }
  assert.equal(clasificarDegradado('¿Cómo anda el rancho esta semana?', ahora).tool, 'consultar_resumen_operativo');
});

test('P9.3 evidencia: una cifra que no está en el cruce se descarta', async () => {
  const restaurar = conEjecutor('cruzar_animales', async (_db, args) => ({ criterios: args.criterios, descripcion: ['enfermos', 'con tareas vencidas'], filtros: {}, criterio: 'c', total: 1, mostrados: 1, items: [{ id: 22, arete_id: 'MX-7002', estado_salud: 'enfermo', tareas_vencidas: 1 }] }));
  let ronda = 0;
  try {
    const r = await conversarConsultivo({
      mensaje: '¿Algún animal enfermo tiene trabajo atrasado?', usuario: admin, db: {}, ahora, telemetria,
      gemini: async () => (++ronda === 1
        ? { functionCall: { name: 'cruzar_animales', args: { criterios: ['enfermo', 'tarea_vencida'] } } }
        : { text: JSON.stringify({ texto: 'Hay 7 animales enfermos con tareas vencidas; probablemente por una infección.' }) }),
    });
    assert.doesNotMatch(r.texto, /7 animales|infecci/);
    assert.match(r.texto, /Hay 1 animales enfermos y con tareas vencidas/);
  } finally { restaurar(); }
});

test('P9.3 permisos: sin permiso no se consulta ni se devuelve "0"', async () => {
  const db = { query: async () => assert.fail('no debe consultar la base sin permiso') };
  await assert.rejects(cruzarAnimales(db, { criterios: ['enfermo', 'prenada'], limite: 25 }, { usuario: { id: 9, rol: 'Invitado' }, ahora }), (e) => e.code === 'TOOL_SIN_PERMISO');
  const resumen = await obtenerResumenOperativo(db, {}, { usuario: { id: 9, rol: 'Invitado' }, ahora });
  assert.deepEqual(resumen.secciones, {});
  assert.ok(resumen.secciones_no_autorizadas.includes('asignaciones'));
  const r = await conversarConsultivo({ mensaje: '¿Qué animales enfermos tienen tareas vencidas?', usuario: { id: 9, rol: 'Invitado' }, db, ahora, telemetria, gemini: sinGemini });
  assert.match(r.texto, /Tu rol no tiene permiso/);
  // Drill-down solo a pantallas permitidas.
  assert.deepEqual(accionesDesdeConsultas([{ nombre: 'consultar_resumen_operativo', resultado: { secciones: { alertas: { tipos: 1 }, tareas: { vencidas: 1 } } } }], 'Invitado'), []);
});
