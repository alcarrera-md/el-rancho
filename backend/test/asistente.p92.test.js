const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  CATALOGO, catalogoParaRol, conversarConsultivo, clasificarConsultaDeterminista, ejecutarTool, accionesDesdeConsultas,
} = require('../src/asistenteConsultivo');
const { firmarContexto, verificarContexto, resolverSeguimiento } = require('../src/asistenteContexto');
const { SEVERIDAD_ALERTA } = require('../src/asistenteSaludService');
const validaciones = require('../src/validation/asistente');

const actor = { id: 7, rol: 'Veterinario' };
const telemetria = () => {};
const ahora = new Date('2026-09-30T12:00:00-06:00');
const sinGemini = async () => assert.fail('no debe llamar a Gemini');

function conEjecutor(nombre, ejecutar) {
  const original = CATALOGO[nombre].ejecutar;
  CATALOGO[nombre].ejecutar = ejecutar;
  return () => { CATALOGO[nombre].ejecutar = original; };
}

function contextoDe(respuesta, usuario = actor) {
  return verificarContexto(firmarContexto(respuesta._contexto, usuario), usuario);
}

const clasificar = (texto) => clasificarConsultaDeterminista(texto, ahora);
const estrella = { id: 11, arete_id: 'MX-4003', nombre_alias: 'Estrella', estado: 'vivo', sexo: 'hembra' };

test('P9.2 clasificador: preguntas de salud, peso, condición, alertas y calendario van a una sola tool', () => {
  const casos = [
    ['¿Qué animales están enfermos?', 'consultar_animales', { estado_salud: 'enfermo', modo: 'lista' }],
    ['¿Qué animales están en observación?', 'consultar_animales', { estado_salud: 'observacion' }],
    ['¿Cuántos animales están sanos?', 'consultar_animales', { estado_salud: 'sano', modo: 'resumen' }],
    ['¿Qué animales tienen problemas de salud?', 'consultar_salud', { enfoque: 'revision' }],
    ['¿Qué animales necesitan revisión?', 'consultar_salud', { enfoque: 'revision' }],
    ['¿Qué pasó con Estrella?', 'consultar_ficha_animal', { identificador: 'Estrella' }],
    ['¿Qué pasó con el animal MX-4003?', 'consultar_ficha_animal', { identificador: 'el animal MX-4003' }],
    ['Dame un resumen de la vaca 248', 'consultar_ficha_animal', { identificador: 'la vaca 248' }],
    ['¿Qué sabes de Estrella?', 'consultar_ficha_animal', { identificador: 'Estrella' }],
    ['¿Cuánto pesa Estrella?', 'consultar_peso', { animal: 'Estrella' }],
    ['¿Qué animales han bajado de peso?', 'consultar_peso', { direccion: 'bajada' }],
    ['¿Qué animales han ganado peso este mes?', 'consultar_peso', { direccion: 'subida', periodo: 'mes_actual' }],
    ['¿Qué condición corporal tiene Estrella?', 'consultar_condicion_corporal', { animal: 'Estrella' }],
    ['¿Qué animales tienen condición corporal baja?', 'consultar_condicion_corporal', { filtro: 'delgada' }],
    ['¿Qué animales empeoraron su condición corporal?', 'consultar_condicion_corporal', { filtro: 'bajo_puntuacion' }],
    ['¿Qué vacunas tiene Estrella?', 'consultar_salud', { enfoque: 'eventos', tipo: 'vacuna', animal: 'Estrella' }],
    ['¿Qué tratamiento tiene registrado Estrella?', 'consultar_salud', { enfoque: 'eventos', tipo: 'tratamiento', animal: 'Estrella' }],
    ['¿Qué eventos de salud tiene el animal 123?', 'consultar_salud', { enfoque: 'eventos', animal: 'el animal 123' }],
    ['¿Qué vacunas vencen pronto?', 'consultar_salud', { enfoque: 'dosis', ventana: 'pronto', tipo: 'vacuna' }],
    ['¿Qué vacunas vencen esta semana?', 'consultar_salud', { enfoque: 'dosis', ventana: 'esta_semana', tipo: 'vacuna' }],
    ['¿Qué próximas dosis hay esta semana?', 'consultar_salud', { enfoque: 'dosis', ventana: 'esta_semana' }],
    ['¿Hay dosis vencidas?', 'consultar_salud', { enfoque: 'dosis', ventana: 'vencidas' }],
    ['¿Qué animales tienen una vacuna mañana?', 'consultar_salud', { enfoque: 'dosis', ventana: 'manana', tipo: 'vacuna' }],
    ['¿Qué alertas tengo hoy?', 'consultar_alertas', {}],
    ['¿Hay alertas importantes?', 'consultar_alertas', { severidad: 'critica' }],
    ['¿Qué alertas corresponden a animales?', 'consultar_alertas', { categoria: 'animales' }],
    ['¿Qué tengo programado hoy?', 'consultar_calendario', { periodo: 'hoy' }],
    ['¿Qué tengo programado mañana?', 'consultar_calendario', { periodo: 'manana' }],
    ['¿Qué hay mañana?', 'consultar_calendario', { periodo: 'manana' }],
    ['¿Qué eventos hay esta semana?', 'consultar_calendario', { periodo: 'esta_semana' }],
    ['¿Qué tengo del 1 al 7 de octubre?', 'consultar_calendario', { periodo: 'personalizado', desde: '2026-10-01', hasta: '2026-10-07' }],
  ];
  for (const [pregunta, tool, esperado] of casos) {
    const clasificado = clasificar(pregunta);
    assert.ok(clasificado, `sin clasificar: ${pregunta}`);
    assert.equal(clasificado.tool, tool, pregunta);
    for (const [clave, valor] of Object.entries(esperado)) assert.equal(clasificado.argumentos[clave], valor, `${pregunta} → ${clave}`);
    // Todo lo que produce el clasificador pasa el esquema Zod de su tool.
    assert.equal(CATALOGO[tool].schema.safeParse(clasificado.argumentos).success, true, pregunta);
  }
  assert.equal(clasificar('¿Qué vacunas vencen pronto?').argumentos.tipo, 'vacuna');
  assert.equal(clasificar('¿Qué próximas dosis hay esta semana?').argumentos.tipo, undefined);
});

test('P9.2 clasificador: typos, acentos y falsos positivos', () => {
  assert.equal(clasificar('Qeu vacunas vencen esta semana').tool, 'consultar_salud');
  assert.equal(clasificar('que animales tienen condicion corporal baja').argumentos.filtro, 'delgada');
  assert.equal(clasificar('Cuanto pesa Estrela').argumentos.animal, 'Estrela', 'la referencia no se "corrige": la resuelve asistenteEntidades');
  assert.equal(clasificar('¿Qué pasó con las ventas?'), null);
  assert.equal(clasificar('¿Qué pasó con el corral 3?'), null);
  assert.equal(clasificar('¿Qué vacunas hay en inventario?'), null);
  assert.equal(clasificar('¿Qué tengo del 31 al 2 de junio?'), null, 'rango imposible no se corrige');
  assert.equal(clasificar('¿Qué hay?'), null);
});

test('P9.2 peso: "Estrella pesa 486 kg" con diferencia calculada en backend; "¿y el pesaje anterior?" en contexto', async () => {
  const llamadas = [];
  const restaurar = conEjecutor('consultar_peso', async (_db, args) => {
    llamadas.push(args);
    return {
      alcance: 'animal', estado: 'con_comparacion', animal: estrella,
      ultimo: { fecha: '2026-09-28', peso_kg: '486.00' }, anterior: { fecha: '2026-09-01', peso_kg: '498.00' },
      diferencia_kg: -12, diferencia_absoluta_kg: 12, dias_entre_pesajes: 27, ganancia_diaria_kg: -0.44,
      historial: [{ fecha: '2026-09-28', peso_kg: '486.00' }, { fecha: '2026-09-01', peso_kg: '498.00' }],
    };
  });
  try {
    const primera = await conversarConsultivo({ mensaje: '¿Cuánto pesa Estrella?', usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(primera.texto, 'Estrella (#MX-4003) pesa 486 kg. Último pesaje: 28/09/2026. Son 12 kg menos que en el pesaje anterior.');
    assert.deepEqual(primera.acciones.map((a) => a.ruta), ['/animales/11/seguimiento?seccion=pesajes']);
    const segunda = await conversarConsultivo({ mensaje: '¿Y el pesaje anterior?', contexto: contextoDe(primera), usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(segunda.texto, 'El pesaje anterior de Estrella (#MX-4003) fue de 498 kg el 01/09/2026. El más reciente es de 486 kg (28/09/2026): 12 kg menos.');
    assert.equal(llamadas.length, 2, 'el seguimiento vuelve a consultar');
    assert.equal(llamadas[1].animal, 'Estrella');
  } finally { restaurar(); }
});

test('P9.2 peso: un solo pesaje y sin pesajes no inventan tendencia ni drill-down', async () => {
  let estado = 'un_pesaje';
  const restaurar = conEjecutor('consultar_peso', async () => (estado === 'un_pesaje'
    ? { alcance: 'animal', estado, animal: estrella, ultimo: { fecha: '2026-09-28', peso_kg: '486.00' }, historial: [{ fecha: '2026-09-28', peso_kg: '486.00' }] }
    : { alcance: 'animal', estado, animal: estrella, historial: [] }));
  try {
    const uno = await conversarConsultivo({ mensaje: '¿Cuánto pesa Estrella?', usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.match(uno.texto, /Solo tiene un pesaje registrado, así que no hay con qué comparar\./);
    estado = 'sin_pesajes';
    const ninguno = await conversarConsultivo({ mensaje: '¿Cuánto pesa Estrella?', usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(ninguno.texto, 'Estrella (#MX-4003) no tiene pesajes registrados.');
    assert.deepEqual(ninguno.acciones, []);
  } finally { restaurar(); }
});

test('P9.2 condición corporal usa la regla existente y describe el cambio', async () => {
  const restaurar = conEjecutor('consultar_condicion_corporal', async () => ({
    alcance: 'animal', animal: estrella, estado: 'con_comparacion', criterio: 'Escala 1-5.',
    ultima: { fecha: '2026-09-28', puntuacion: 2 }, anterior: { fecha: '2026-08-30', puntuacion: 3 }, cambio: -1, clasificacion: 'delgada', historial: [],
  }));
  try {
    const r = await conversarConsultivo({ mensaje: '¿Qué condición corporal tiene Estrella?', usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(r.texto, 'Estrella (#MX-4003) tiene condición corporal 2/5 (delgada), medida el 28/09/2026. Bajó 1 punto(s) respecto a la medición anterior (3/5, 30/08/2026).');
  } finally { restaurar(); }
});

test('P9.2 salud: listas vacías responden sin cifras inventadas ni acciones', async () => {
  const restaurar = conEjecutor('consultar_salud', async (_db, args) => ({ enfoque: 'dosis', ventana: args.ventana, tipo: args.tipo, total: 0, animales: 0, mostrados: 0, items: [], criterio: 'Criterio.' }));
  const restaurarAlertas = conEjecutor('consultar_alertas', async () => ({ total_tipos: 0, por_severidad: { critica: 0, advertencia: 0, info: 0 }, alertas: [], criterio: 'Alertas vigentes.' }));
  const restaurarCalendario = conEjecutor('consultar_calendario', async () => ({ rango: { periodo: 'manana', desde: '2026-10-01', hasta: '2026-10-01' }, total: 0, por_tipo: {}, mostrados: 0, items: [], criterio: 'Calendario.' }));
  try {
    const dosis = await conversarConsultivo({ mensaje: '¿Qué vacunas vencen esta semana?', usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(dosis.texto, 'No hay vacuna(s) para lo que resta de esta semana.');
    assert.deepEqual(dosis.acciones, []);
    const vencidas = await conversarConsultivo({ mensaje: '¿Hay dosis vencidas?', usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(vencidas.texto, 'No hay dosis vencidas.');
    const alertas = await conversarConsultivo({ mensaje: '¿Qué alertas tengo hoy?', usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(alertas.texto, 'No hay alertas vigentes.');
    const calendario = await conversarConsultivo({ mensaje: '¿Qué tengo programado mañana?', usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(calendario.texto, 'No hay nada programado el 01/10/2026.');
    assert.deepEqual(calendario.acciones, []);
  } finally { restaurar(); restaurarAlertas(); restaurarCalendario(); }
});

test('P9.2 alertas y calendario: resumen primero, luego detalle, con drill-down a su pantalla', async () => {
  const restaurar = conEjecutor('consultar_alertas', async () => ({
    total_tipos: 2, por_severidad: { critica: 1, advertencia: 1, info: 0 }, criterio: 'Alertas vigentes.',
    alertas: [{ tipo: 'Vacuna vencida', severidad: 'critica', total: 3 }, { tipo: 'Stock bajo', severidad: 'advertencia', total: 2 }],
  }));
  const restaurarCalendario = conEjecutor('consultar_calendario', async () => ({
    rango: { periodo: 'manana', desde: '2026-10-01', hasta: '2026-10-01' }, total: 2, por_tipo: { vacuna: 1, tarea: 1 }, mostrados: 2, criterio: 'Calendario.',
    items: [{ fecha: '2026-10-01', tipo: 'vacuna', etiqueta: 'Próxima dosis', titulo: 'vacuna — MX-4003' }, { fecha: '2026-10-01', tipo: 'tarea', etiqueta: 'Tarea', titulo: 'Revisar bebederos', trabajador: 'Ana' }],
  }));
  try {
    const alertas = await conversarConsultivo({ mensaje: '¿Qué alertas tengo hoy?', usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(alertas.texto, 'Hay 2 tipo(s) de alerta vigentes: 1 crítica(s), 1 de advertencia y 0 informativa(s).');
    assert.deepEqual(alertas.lista, ['Vacuna vencida (crítica): 3', 'Stock bajo (advertencia): 2']);
    assert.deepEqual(alertas.acciones.map((a) => a.ruta), ['/alertas']);
    const calendario = await conversarConsultivo({ mensaje: '¿Qué tengo programado mañana?', usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(calendario.texto, 'El 01/10/2026 hay 2 evento(s): 1 próxima(s) dosis, 1 tarea(s).');
    assert.deepEqual(calendario.acciones.map((a) => a.ruta), ['/calendario']);
  } finally { restaurar(); restaurarCalendario(); }
});

test('P9.2 contexto: vacunas del animal en foco y "¿y cuáles vencen pronto?"', async () => {
  const llamadas = [];
  const restaurarFicha = conEjecutor('consultar_ficha_animal', async () => ({ animal: { ...estrella, categoria: 'vientre', estado_salud: 'sano' }, ultimos_pesajes: [], condicion_corporal: [], ultimos_eventos_salud: [], proximas_dosis: [], dosis_vencidas: 0, tareas: { pendientes: 0, vencidas: 0 }, ultimo_movimiento: null }));
  const restaurarSalud = conEjecutor('consultar_salud', async (_db, args) => {
    llamadas.push(args);
    return args.enfoque === 'eventos'
      ? { enfoque: 'eventos', tipo: args.tipo, animal: estrella, total: 1, animales: 1, por_tipo: [], mostrados: 1, items: [{ fecha: '2026-06-01', tipo: 'vacuna', enfermedad: 'Clostridiosis', proxima_dosis: '2026-10-02' }] }
      : { enfoque: 'dosis', ventana: args.ventana, tipo: args.tipo, animal: estrella, total: 1, animales: 1, mostrados: 1, criterio: 'Criterio.', items: [{ tipo: 'vacuna', enfermedad: 'Clostridiosis', proxima_dosis: '2026-10-02' }] };
  });
  try {
    const ficha = await conversarConsultivo({ mensaje: '¿Qué pasó con Estrella?', usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.match(ficha.texto, /^Estrella \(#MX-4003\): hembra · vientre · vivo, salud sano\./);
    const vacunas = await conversarConsultivo({ mensaje: '¿Qué vacunas tiene?', contexto: contextoDe(ficha), usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.deepEqual(llamadas[0], { enfoque: 'eventos', tipo: 'vacuna', animal: 'MX-4003', limite: 10 });
    assert.equal(vacunas.texto, '1 vacuna(s) registrado(s) de Estrella (#MX-4003).');
    const pronto = await conversarConsultivo({ mensaje: '¿Y cuáles vencen pronto?', contexto: contextoDe(vacunas), usuario: actor, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.deepEqual(llamadas[1], { enfoque: 'dosis', ventana: 'pronto', tipo: 'vacuna', animal: 'MX-4003', limite: 25 });
    assert.match(pronto.texto, /^Hay 1 vacuna\(s\) próximas de Estrella/);
    assert.deepEqual(pronto.acciones.map((a) => a.ruta), ['/animales/11/seguimiento?seccion=vacunaciones']);
  } finally { restaurarFicha(); restaurarSalud(); }
});

test('P9.2 contexto: "¿y cuáles están en el Corral Engorde 2?" conserva el estado de salud', () => {
  const contexto = { tool: 'consultar_animales', argumentos: { modo: 'lista', estado_salud: 'enfermo', limite: 25 }, entidades: [] };
  assert.deepEqual(resolverSeguimiento('¿Y cuáles están en el Corral Engorde 2?', contexto, { catalogo: CATALOGO }).argumentos,
    { modo: 'lista', estado_salud: 'enfermo', limite: 25, corral: 'corral engorde 2' });
  const dosis = { tool: 'consultar_salud', argumentos: { enfoque: 'dosis', ventana: 'pronto', tipo: 'vacuna', limite: 25 }, entidades: [] };
  assert.equal(resolverSeguimiento('¿Y mañana?', dosis, { catalogo: CATALOGO }).argumentos.ventana, 'manana');
  const revision = { tool: 'consultar_salud', argumentos: { enfoque: 'revision', limite: 25 }, entidades: [] };
  assert.match(resolverSeguimiento('¿Y el mes pasado?', revision, { catalogo: CATALOGO }).texto, /^No puedo determinar qué animales estaban enfermos o en observación el mes pasado/);
  const pesoAnimal = { tool: 'consultar_peso', argumentos: { animal: 'Estrella', limite: 5 }, entidades: [{ tipo: 'animal', valor: 'MX-4003', etiqueta: '#MX-4003' }] };
  assert.equal(resolverSeguimiento('¿Y el mes pasado?', pesoAnimal, { catalogo: CATALOGO }), null, 'no se reutiliza el peso actual como del mes pasado');
});

test('P9.2 contexto manipulado o vencido se descarta', () => {
  const firmado = firmarContexto({ tool: 'consultar_peso', argumentos: { animal: 'MX-4003', limite: 5 }, entidades: [{ tipo: 'animal', valor: 'MX-4003', etiqueta: '#MX-4003' }] }, actor, Date.now());
  assert.ok(verificarContexto(firmado, actor));
  assert.equal(verificarContexto({ ...firmado, argumentos: { animal: 'OTRO', limite: 5 } }, actor), null);
  assert.equal(verificarContexto({ ...firmado, entidades: [{ tipo: 'animal', valor: '1', etiqueta: '#1' }] }, actor), null);
  assert.equal(verificarContexto(firmado, actor, firmado.expira_en), null);
});

test('P9.2 permisos: tools por rol según policy.js, sin convertir un rechazo en cero resultados', async () => {
  const nuevas = ['consultar_salud', 'consultar_peso', 'consultar_condicion_corporal', 'consultar_alertas', 'consultar_calendario'];
  for (const rol of ['Administrador', 'Veterinario', 'Trabajador', 'Auditor']) {
    const nombres = catalogoParaRol(rol).map((tool) => tool.name);
    for (const nombre of nuevas) assert.ok(nombres.includes(nombre), `${rol} lee ${nombre} según policy.js`);
  }
  await assert.rejects(ejecutarTool('consultar_salud', { enfoque: 'revision' }, { usuario: { id: 1, rol: 'Invitado' }, db: {}, telemetria }), (e) => e.code === 'TOOL_SIN_PERMISO');
  const respuesta = await conversarConsultivo({ mensaje: '¿Qué alertas tengo hoy?', usuario: { id: 1, rol: 'Invitado' }, db: {}, ahora, telemetria, gemini: sinGemini });
  assert.match(respuesta.texto, /Tu rol no tiene permiso/);
  // Drill-down: solo pantallas que el rol puede abrir.
  const consultas = [{ nombre: 'consultar_alertas', resultado: { total_tipos: 1 } }, { nombre: 'consultar_calendario', resultado: { total: 1 } }];
  assert.deepEqual(accionesDesdeConsultas(consultas, 'Trabajador').map((a) => a.ruta), ['/alertas', '/calendario']);
  assert.deepEqual(accionesDesdeConsultas(consultas, 'Invitado'), []);
});

test('P9.2 Zod: argumentos acotados y sin extras', () => {
  assert.equal(validaciones.saludGlobal.safeParse({ enfoque: 'dosis', ventana: 'ayer' }).success, false);
  assert.equal(validaciones.saludGlobal.safeParse({ enfoque: 'eventos', sql: 'x' }).success, false);
  assert.equal(validaciones.saludGlobal.safeParse({ enfoque: 'eventos', desde: '2026-09-01' }).success, false);
  assert.equal(validaciones.pesoGlobal.safeParse({ limite: 26 }).success, false);
  assert.equal(validaciones.condicionCorporalGlobal.safeParse({ puntuacion: 6 }).success, false);
  assert.equal(validaciones.alertasGlobal.safeParse({ severidad: 'urgente' }).success, false);
  assert.equal(validaciones.calendarioGlobal.safeParse({ periodo: 'personalizado', desde: '2026-10-01' }).success, false);
  assert.equal(validaciones.calendarioGlobal.safeParse({ periodo: 'anio_actual' }).success, false);
});

test('P9.2 Gemini: 503 con evidencia responde con los datos verificados; cifra no respaldada se descarta', async () => {
  const restaurar = conEjecutor('consultar_alertas', async () => ({ total_tipos: 1, por_severidad: { critica: 1, advertencia: 0, info: 0 }, criterio: 'Alertas vigentes.', alertas: [{ tipo: 'Estado de salud', severidad: 'critica', total: 2 }] }));
  try {
    let ronda = 0;
    const degradada = await conversarConsultivo({
      mensaje: '¿Hay algo urgente en las alertas del rancho?', usuario: actor, db: {}, ahora, telemetria,
      gemini: async () => {
        ronda += 1;
        if (ronda === 1) return { functionCall: { name: 'consultar_alertas', args: { severidad: 'critica' } } };
        throw Object.assign(new Error('saturado'), { code: 'GEMINI_SERVICE_UNAVAILABLE' });
      },
    });
    assert.match(degradada.texto, /Hay 1 tipo\(s\) de alerta vigentes/);
    ronda = 0;
    const inventada = await conversarConsultivo({
      mensaje: '¿Hay algo urgente en las alertas del rancho?', usuario: actor, db: {}, ahora, telemetria,
      gemini: async () => (++ronda === 1
        ? { functionCall: { name: 'consultar_alertas', args: {} } }
        : { text: JSON.stringify({ texto: 'Hay 9 animales enfermos.' }) }),
    });
    assert.doesNotMatch(inventada.texto, /9 animales/);
    assert.match(inventada.texto, /Estado de salud|alerta/);
  } finally { restaurar(); }
  // 429 sin evidencia conserva el error del proveedor (no inventa).
  await assert.rejects(conversarConsultivo({
    mensaje: '¿Cómo ves la salud del hato en general?', usuario: actor, db: {}, ahora, telemetria,
    gemini: async () => { throw Object.assign(new Error('límite'), { code: 'GEMINI_RATE_LIMIT' }); },
  }), (e) => e.code === 'GEMINI_RATE_LIMIT');
});

test('P9.2 alertas: la severidad por tipo es exactamente la que asigna la pantalla Alertas', async () => {
  const modulo = await import(pathToFileURL(path.join(__dirname, '../../frontend/src/alertas.js')).href);
  const hoy = new Date('2026-09-30T12:00:00');
  const alertas = modulo.construirAlertas({
    vacunas: [{ id: 1, proxima_dosis: '2026-09-01', tipo: 'vacuna', arete_id: 'A' }, { id: 2, proxima_dosis: '2026-10-05', tipo: 'vacuna', arete_id: 'B' }],
    partos: [{ id: 1, madre_id: 1, madre_arete: 'A', fecha_parto_estimada: '2026-10-10' }],
    enfermos: [{ id: 1, arete_id: 'A' }], observacion: [{ id: 2, arete_id: 'B' }],
    stock: [{ id: 1, nombre: 'Heno', stock_actual: 0, stock_minimo: 5, unidad_medida: 'kg' }, { id: 2, nombre: 'Sal', stock_actual: 1, stock_minimo: 5, unidad_medida: 'kg' }],
    corrales: [{ id: 1, nombre: 'Norte', capacidad_maxima: 10, ocupacion_actual: 10, enfermos: 1 }],
    hato: { pesajes_atrasados: [{ corral_id: 1, corral: 'Norte', atrasados: 2, total_corral: 10 }], clusters: [{ animal_ids: [1, 2], animales: [{ id: 1, estado_salud: 'enfermo' }], corrales: ['Norte'] }], mortalidad: null },
    resumen: { plan_sanitario_pendiente: 1, tareas_pendientes: 1 },
  }, hoy);
  const frontend = Object.fromEntries(alertas.map((alerta) => [alerta.tipo, alerta.severidad]));
  for (const [tipo, severidad] of Object.entries(SEVERIDAD_ALERTA)) {
    assert.equal(frontend[tipo], severidad, `severidad de "${tipo}"`);
  }
});

test('P9.2 drill-down: toda ruta nueva existe en el router y en las secciones del seguimiento', () => {
  const fs = require('fs');
  const app = fs.readFileSync(path.join(__dirname, '../../frontend/src/App.jsx'), 'utf8');
  const navegacion = fs.readFileSync(path.join(__dirname, '../../frontend/src/navigationContext.js'), 'utf8');
  const rutas = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((r) => r !== '*');
  const animal = { id: 11, arete_id: 'MX-4003' };
  const acciones = [
    [{ nombre: 'consultar_salud', resultado: { enfoque: 'revision', total: 1 } }],
    [{ nombre: 'consultar_salud', resultado: { enfoque: 'eventos', total: 1 } }],
    [{ nombre: 'consultar_salud', resultado: { enfoque: 'eventos', tipo: 'vacuna', total: 1, animal } }],
    [{ nombre: 'consultar_salud', resultado: { enfoque: 'eventos', tipo: 'tratamiento', total: 1, animal } }],
    [{ nombre: 'consultar_peso', resultado: { alcance: 'hato', mostrados: 1 } }],
    [{ nombre: 'consultar_peso', resultado: { alcance: 'animal', estado: 'un_pesaje', animal } }],
    [{ nombre: 'consultar_condicion_corporal', resultado: { alcance: 'animal', estado: 'una_medicion', animal } }],
    [{ nombre: 'consultar_alertas', resultado: { total_tipos: 1 } }],
    [{ nombre: 'consultar_calendario', resultado: { total: 1 } }],
  ].flatMap((consultas) => accionesDesdeConsultas(consultas, 'Auditor'));
  assert.equal(acciones.length, 9);
  for (const accion of acciones) {
    const [ruta, query] = accion.ruta.split('?');
    assert.ok(rutas.some((patron) => new RegExp(`^${patron.replace(/:[a-z]+/g, '[^/]+')}$`).test(ruta)), `ruta inexistente: ${accion.ruta}`);
    if (query) assert.match(navegacion, new RegExp(`'${query.split('=')[1]}'`), `sección inexistente: ${accion.ruta}`);
  }
  // Sin conjunto no hay acción.
  assert.deepEqual(accionesDesdeConsultas([{ nombre: 'consultar_salud', resultado: { enfoque: 'dosis', total: 0 } }, { nombre: 'consultar_peso', resultado: { alcance: 'animal', estado: 'sin_pesajes', animal } }]), []);
});
