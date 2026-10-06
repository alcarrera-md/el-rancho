const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATALOGO, conversarConsultivo, clasificarConsultaDeterminista, clasificarDegradado, esPreguntaDeCompra, accionesDesdeConsultas,
} = require('../src/asistenteConsultivo');
const { firmarContexto, verificarContexto, resolverSeguimiento } = require('../src/asistenteContexto');
const { interpretarFrasePeriodo } = require('../src/periodos');
const validaciones = require('../src/validation/asistente');

const admin = { id: 1, rol: 'Administrador' };
const veterinario = { id: 7, rol: 'Veterinario' };
const telemetria = () => {};
const ahora = new Date('2026-09-30T12:00:00-06:00');
const sinGemini = async () => assert.fail('no debe llamar a Gemini');
const clasificar = (texto) => clasificarConsultaDeterminista(texto, ahora);

function conEjecutor(nombre, ejecutar) {
  const original = CATALOGO[nombre].ejecutar;
  CATALOGO[nombre].ejecutar = ejecutar;
  return () => { CATALOGO[nombre].ejecutar = original; };
}

// Los ejecutores reciben además los valores por defecto de Zod (limite, incluir_inactivos).
function incluye(actual, esperado, mensaje) {
  assert.deepEqual(Object.fromEntries(Object.keys(esperado).map((clave) => [clave, actual[clave]])), esperado, mensaje);
}

function contextoDe(respuesta, usuario = admin) {
  return verificarContexto(firmarContexto(respuesta._contexto, usuario), usuario);
}

const animalesFalsos = (llamadas) => async (_db, args) => {
  llamadas.push({ ...args });
  return {
    filtros: { ...args },
    resumen: { total: 4, hembras: 3, machos: 1 },
    ...(args.periodo ? { rango: normalizar(args) } : {}),
    items: args.modo === 'lista' ? [{ arete_id: 'A-1', nombre_alias: 'Luna', estado_salud: args.estado_salud || 'sano', fecha_baja: args.estado ? '2026-09-12' : null }] : [],
  };
};
function normalizar(args) {
  return args.periodo === 'personalizado' ? { periodo: 'personalizado', desde: args.desde, hasta: args.hasta } : { periodo: args.periodo, desde: '2026-09-01', hasta: '2026-09-30' };
}

test('P9.2.1 bug: "¿cuántos están en observación?" es estado de salud, nunca un corral', async () => {
  const llamadas = [];
  const restaurar = conEjecutor('consultar_animales', animalesFalsos(llamadas));
  try {
    const total = await conversarConsultivo({ mensaje: '¿Cuántos animales tengo?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    const nombres = await conversarConsultivo({ mensaje: '¿Cuáles son sus nombres?', contexto: contextoDe(total), usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(llamadas[1].modo, 'lista');
    const observacion = await conversarConsultivo({ mensaje: '¿Cuántos están en observación?', contexto: contextoDe(nombres), usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    incluye(llamadas[2], { modo: 'resumen', estado_salud: 'observacion', estado: undefined });
    assert.equal('corral' in llamadas[2], false);
    assert.doesNotMatch(observacion.texto, /corral/i);
  } finally { restaurar(); }
  // Sin contexto la misma frase también se resuelve localmente.
  assert.deepEqual(clasificar('¿Cuántos están en observación?').argumentos, { modo: 'resumen', estado_salud: 'observacion' });
  // Con un corral previo, la forma corta conserva ese corral.
  const enCorral = { tool: 'consultar_animales', argumentos: { modo: 'resumen', corral: 'Norte' }, entidades: [] };
  assert.deepEqual(resolverSeguimiento('¿Cuántos están en observación?', enCorral, { catalogo: CATALOGO, ahora }).argumentos, { corral: 'Norte', estado_salud: 'observacion', modo: 'resumen' });
  // El seguimiento de corral exige la palabra "corral".
  const lista = { tool: 'consultar_animales', argumentos: { modo: 'lista', estado_salud: 'enfermo' }, entidades: [] };
  assert.equal(resolverSeguimiento('¿Cuáles están en el corral Norte?', lista, { catalogo: CATALOGO, ahora }).argumentos.corral, 'corral norte');
  assert.equal(resolverSeguimiento('¿Cuáles están en Norte?', lista, { catalogo: CATALOGO, ahora }), null);
  assert.equal(resolverSeguimiento('¿Cuántos hay en observación?', lista, { catalogo: CATALOGO, ahora }).argumentos.estado_salud, 'observacion');
});

test('P9.2.1 muertes: total histórico y seguimiento por periodo sobre la fecha de baja', async () => {
  const llamadas = [];
  const restaurar = conEjecutor('consultar_animales', animalesFalsos(llamadas));
  try {
    const total = await conversarConsultivo({ mensaje: '¿Cuántos animales han muerto?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(total.texto, 'Hay 4 animales muertos registrados.');
    const mes = await conversarConsultivo({ mensaje: '¿Y en el último mes?', contexto: contextoDe(total), usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    incluye(llamadas[1], { estado: 'muerto', modo: 'resumen', periodo: 'ultimos_30_dias' });
    assert.match(mes.texto, /^Hubo 4 muertes registrada\(s\) del /);
    const tres = await conversarConsultivo({ mensaje: '¿Y en los últimos 3 meses?', contexto: contextoDe(total), usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    incluye(llamadas[2], { estado: 'muerto', modo: 'resumen', periodo: 'personalizado', desde: '2026-06-30', hasta: '2026-09-30' });
    assert.match(tres.texto, /del 30\/06\/2026 al 30\/09\/2026/);
  } finally { restaurar(); }
  assert.deepEqual(clasificar('¿Cuántos animales murieron el mes pasado?').argumentos, { estado: 'muerto', modo: 'resumen', periodo: 'mes_pasado' });
  assert.deepEqual(clasificar('¿Cuántos murieron hoy?').argumentos, { estado: 'muerto', modo: 'resumen', periodo: 'hoy' });
  assert.equal(clasificar('¿Cuántos animales murieron por enfermedad?'), null, 'una cola que no es periodo se deja a Gemini');
  // Animales vivos no tienen periodo: Zod lo rechaza y el seguimiento lo explica.
  assert.equal(validaciones.animalesGlobal.safeParse({ periodo: 'mes_pasado' }).success, false);
  const vivos = { tool: 'consultar_animales', argumentos: { modo: 'resumen' }, entidades: [] };
  assert.match(resolverSeguimiento('¿Y en el último mes?', vivos, { catalogo: CATALOGO, ahora }).texto, /^No puedo determinar cuántos animales había/);
});

test('P9.2.1 trabajadores: solo con el permiso existente; un rechazo no es "0 trabajadores"', async () => {
  const restaurar = conEjecutor('consultar_trabajadores', async (_db, args) => ({ ...(args.estado ? { estado: args.estado } : {}), resumen: { total: 5, activos: 4, inactivos: 1 }, total: 5, mostrados: 2, items: [{ nombre: 'Ana', activo: true }, { nombre: 'Beto', activo: false }] }));
  try {
    const r = await conversarConsultivo({ mensaje: '¿Cuántos trabajadores hay en el sistema?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(r.texto, 'Hay 5 trabajador(es) registrados: 4 activo(s) y 1 inactivo(s).');
    assert.deepEqual(r.lista, ['Ana', 'Beto · inactivo']);
    assert.deepEqual(r.acciones.map((a) => a.ruta), ['/trabajadores']);
    const sinPermiso = await conversarConsultivo({ mensaje: '¿Cuántos trabajadores hay en el sistema?', usuario: veterinario, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.match(sinPermiso.texto, /Tu rol no tiene permiso/);
    assert.doesNotMatch(sinPermiso.texto, /\d/);
  } finally { restaurar(); }
  assert.deepEqual(clasificar('¿Cuántos trabajadores activos hay?').argumentos, { estado: 'activos' });
  assert.equal(clasificar('¿Quiénes son los trabajadores?').tool, 'consultar_trabajadores');
});

test('P9.2.1 drill-down: un destino aparece una sola vez y con su propio nombre', () => {
  const acciones = accionesDesdeConsultas([
    { nombre: 'consultar_finanzas', resultado: { metrica: 'egresos', cantidad: 3 } },
    { nombre: 'consultar_finanzas', resultado: { metrica: 'leche', cantidad: 2 } },
    { nombre: 'consultar_finanzas', resultado: { metrica: 'ventas', cantidad: 1 } },
    { nombre: 'consultar_finanzas', resultado: { metrica: 'gastos', cantidad: 1 } },
    { nombre: 'consultar_finanzas', resultado: { metrica: 'compras_animales', cantidad: 1 } },
  ]);
  assert.deepEqual(acciones.map((a) => [a.etiqueta, a.ruta]), [['Ver finanzas', '/finanzas'], ['Ver ventas', '/ventas'], ['Ver gastos', '/gastos'], ['Ver compras', '/compras?vista=animales']]);
  assert.equal(new Set(acciones.map((a) => a.etiqueta)).size, acciones.length);
  // Compras de insumos y de animales comparten pantalla: un solo botón.
  assert.equal(accionesDesdeConsultas([
    { nombre: 'consultar_finanzas', resultado: { metrica: 'compras_insumos', cantidad: 1 } },
    { nombre: 'consultar_finanzas', resultado: { metrica: 'compras_animales', cantidad: 1 } },
  ]).length, 1);
});

test('P9.2.1 movimientos: periodos calculados en backend, sin Gemini', () => {
  const casos = {
    'Dame los movimientos de hoy': { periodo: 'hoy' },
    'Movimientos de esta semana': { periodo: 'esta_semana' },
    '¿Qué movimientos hubo este mes?': { periodo: 'mes_actual' },
    'Movimientos del mes pasado': { periodo: 'mes_pasado' },
    'Dame los movimientos de los últimos 15 días': { periodo: 'personalizado', desde: '2026-09-16', hasta: '2026-09-30' },
    'Dame los movimientos de los últimos 3 meses': { periodo: 'personalizado', desde: '2026-06-30', hasta: '2026-09-30' },
    'Movimientos del 1 al 15 de septiembre': { periodo: 'personalizado', desde: '2026-09-01', hasta: '2026-09-15' },
    '¿Tienes los movimientos?': { periodo: 'anio_actual' },
  };
  for (const [pregunta, esperado] of Object.entries(casos)) {
    const r = clasificar(pregunta);
    assert.equal(r?.tool, 'consultar_movimientos', pregunta);
    for (const [clave, valor] of Object.entries(esperado)) assert.equal(r.argumentos[clave], valor, `${pregunta} → ${clave}`);
    assert.equal(CATALOGO.consultar_movimientos.schema.safeParse(r.argumentos).success, true, pregunta);
  }
  assert.equal(clasificar('¿Qué movimientos hizo la vaca 248?'), null);
  assert.equal(interpretarFrasePeriodo('ultimos 0 dias', ahora), null);
  assert.equal(interpretarFrasePeriodo('del 31 al 2 de junio', ahora), null);
});

test('P9.2.1 preguntas frecuentes respondidas con 0 llamadas a Gemini', () => {
  const frecuentes = [
    '¿Cuántos animales tengo?', '¿Cuántas vacas hay?', '¿Cuántos toros hay?', '¿Cuántas hembras hay?', '¿Cuántos machos hay?', '¿Cuántos becerros hay?',
    '¿Qué animales están enfermos?', '¿Qué animales están en observación?', '¿Cuántos animales están sanos?', '¿Cuántos están en observación?',
    '¿Qué animales necesitan atención hoy?', '¿Qué animales tienen problemas de salud?', '¿Cuántos animales han muerto?', '¿Cuántos animales murieron el mes pasado?',
    '¿Qué corral está más lleno?', '¿Cuánto alimento queda?', '¿Qué alimento tengo?', '¿Qué alimento se está acabando?', '¿Qué alimento está bajo?',
    '¿Qué tareas están vencidas?', '¿Qué tareas están pendientes?', 'Mis tareas',
    '¿Cuántas vacas están preñadas?', '¿Qué vacas están próximas a parto?', '¿Qué vacas necesitan palpación?', '¿Cuántas parieron este año?',
    '¿Cuánto gastamos este mes?', '¿Cuánto vendimos este mes?', '¿Cuánto vendimos este año?',
    '¿Qué movimientos hubo esta semana?', 'Dame los movimientos de los últimos 3 meses', '¿Tienes los movimientos?',
    'Clima hoy', '¿Qué clima hace?', '¿Va a llover mañana?', '¿Qué temperatura hace?', 'Pronóstico de mañana',
    '¿Qué pasó con Estrella?', 'Dime sobre Julio', 'Dame un resumen de la vaca 248', '¿Cómo está la vaca Larra?', 'Estado de salud de Estrella',
    '¿Cuánto pesa Estrella?', 'Que pesaje tiene la vaca Larra?', '¿Qué condición corporal tiene Estrella?', 'Condición corporal de Estrella',
    '¿Qué animales han bajado de peso?', '¿Qué animales tienen condición corporal baja?',
    '¿Qué vacunas vencen esta semana?', '¿Hay dosis vencidas?', '¿Qué vacunas tiene Estrella?',
    '¿Qué alertas tengo hoy?', 'Alertas', '¿Hay alertas importantes?',
    '¿Qué tengo programado mañana?', 'Calendario de hoy', '¿Qué tengo del 1 al 7 de octubre?',
    '¿Cuántos trabajadores hay en el sistema?',
    'Cauntas vacas hay?', 'Que animales estan enfermos?',
  ];
  const locales = frecuentes.filter((pregunta) => clasificar(pregunta));
  assert.deepEqual(frecuentes.filter((pregunta) => !clasificar(pregunta)), []);
  assert.equal(locales.length, 60);
});

test('P9.2.1 degradación: 429/503/timeout sin evidencia responde con la tool determinista del único módulo nombrado', async () => {
  const restaurar = conEjecutor('consultar_alertas', async (_db, args) => ({ ...(args.severidad ? { severidad: args.severidad } : {}), total_tipos: 1, por_severidad: { critica: 1, advertencia: 0, info: 0 }, criterio: 'Alertas vigentes.', alertas: [{ tipo: 'Estado de salud', severidad: 'critica', total: 2 }] }));
  try {
    for (const code of ['GEMINI_RATE_LIMIT', 'GEMINI_SERVICE_UNAVAILABLE', 'GEMINI_TIMEOUT', 'GEMINI_NOT_CONFIGURED']) {
      const r = await conversarConsultivo({
        mensaje: '¿Qué alertas importantes hay en el rancho ahora?', usuario: admin, db: {}, ahora, telemetria,
        gemini: async () => { throw Object.assign(new Error('proveedor'), { code }); },
      });
      assert.match(r.texto, /Hay 1 tipo\(s\) de alerta vigentes de severidad crítica/, code);
      assert.match(r.advertencia, /El asistente de IA no estuvo disponible; respondí con la consulta de alertas/);
      assert.doesNotMatch(r.texto, /saturado/);
    }
  } finally { restaurar(); }
  // Dos módulos o ninguno: no se adivina y se conserva el error del proveedor.
  assert.equal(clasificarDegradado('¿Qué tareas y alertas tengo?', ahora), null);
  assert.equal(clasificarDegradado('¿Cómo ves el rancho?', ahora), null);
  await assert.rejects(conversarConsultivo({
    mensaje: '¿Cómo ves el rancho en general?', usuario: admin, db: {}, ahora, telemetria,
    gemini: async () => { throw Object.assign(new Error('saturado'), { code: 'GEMINI_RATE_LIMIT' }); },
  }), (e) => e.code === 'GEMINI_RATE_LIMIT');
});

test('P9.2.1 compras: no se inventa una recomendación; se muestra la regla existente de stock mínimo', async () => {
  const llamadas = [];
  const restaurar = conEjecutor('consultar_inventario', async (_db, args) => {
    llamadas.push(args);
    return args.estado === 'bajo'
      ? { totales_por_unidad: [], items: [{ nombre: 'Mineral', stock_actual: '18.00', stock_minimo: '20.00', unidad_medida: 'kg', estado_stock: 'bajo' }], total_productos: 1, mostrados: 1, regla_unidades: 'x' }
      : { totales_por_unidad: [{ tipo: 'alimento', unidad: 'kg', productos: 2, stock_total: '338' }], items: [], total_productos: 2, mostrados: 0, regla_unidades: 'x' };
  });
  try {
    const compra = await conversarConsultivo({ mensaje: '¿Qué comida debo comprar para las vacas?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    incluye(llamadas[0], { estado: 'bajo', tipo: 'alimento' });
    assert.match(compra.texto, /^Todavía no existe en El Rancho una regla para calcular qué o cuánto comprar/);
    assert.match(compra.texto, /1 producto\(s\) de tipo alimento están en o por debajo de su mínimo\./);
    assert.deepEqual(compra.lista, ['Mineral: 18 kg (mínimo 20 kg)']);
    const tengo = await conversarConsultivo({ mensaje: '¿Qué alimento tengo?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    incluye(llamadas[1], { tipo: 'alimento', estado: 'todos' });
    assert.doesNotMatch(tengo.texto, /comprar/);
  } finally { restaurar(); }
  assert.equal(esPreguntaDeCompra('¿Qué alimento está bajo?'), false);
  assert.equal(esPreguntaDeCompra('¿Qué necesito comprar?'), true);
  assert.equal(esPreguntaDeCompra('¿Cuánto compramos este mes?'), false);
});

// --- Cierre de P9.2.1: combinaciones sustantivo + salud y entidad nueva explícita ----------

test('P9.2.1 cierre: sustantivo + estado de salud se combinan localmente con los filtros de consultar_animales', async () => {
  const casos = [
    ['Cuantas vacas estan en observacion?', 'vacas', { sexo: 'hembra', etapa: 'adulto', estado_salud: 'observacion', modo: 'resumen' }],
    ['¿Qué vacas están enfermas?', 'vacas', { sexo: 'hembra', etapa: 'adulto', estado_salud: 'enfermo', modo: 'lista' }],
    ['¿Cuántos toros están enfermos?', 'toros', { sexo: 'macho', etapa: 'adulto', estado_salud: 'enfermo', modo: 'resumen' }],
    ['¿Cuáles hembras están sanas?', 'hembras', { sexo: 'hembra', etapa: undefined, estado_salud: 'sano', modo: 'lista' }],
    ['¿Cuántos machos están en observación?', 'machos', { sexo: 'macho', etapa: undefined, estado_salud: 'observacion', modo: 'resumen' }],
    ['¿Cuántos becerros están enfermos?', 'crias', { sexo: undefined, etapa: 'cria', estado_salud: 'enfermo', modo: 'resumen' }],
    ['Cauntas vacas estan en observacion', 'vacas', { estado_salud: 'observacion' }],
  ];
  for (const [pregunta, intencion, esperado] of casos) {
    const r = clasificar(pregunta);
    assert.equal(r?.intencion, intencion, pregunta);
    incluye(r.argumentos, esperado, pregunta);
    assert.equal(CATALOGO.consultar_animales.schema.safeParse(r.argumentos).success, true, pregunta);
  }
  // vacías nunca se vuelven vacas.
  assert.equal(clasificar('¿Cuántas vacías están enfermas?'), null);
  const llamadas = [];
  const restaurar = conEjecutor('consultar_animales', async (_db, args) => {
    llamadas.push(args);
    return { filtros: { ...args }, resumen: { total: 2, hembras: 2, machos: 0 }, grupos: [{ grupo: 'vientre', total: 2 }], items: [] };
  });
  try {
    const r = await conversarConsultivo({ mensaje: 'Cuantas vacas estan en observacion?', usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    assert.equal(r.texto, 'Actualmente hay 2 vacas vivas registradas (en observación).');
    incluye(llamadas[0], { sexo: 'hembra', etapa: 'adulto', estado_salud: 'observacion' });
  } finally { restaurar(); }
});

const ANIMALES = {
  larra: { id: 21, arete_id: 'MX-7001', nombre_alias: 'Larra', estado: 'vivo', sexo: 'hembra' },
  julio: { id: 22, arete_id: 'MX-7002', nombre_alias: 'Julio', estado: 'vivo', sexo: 'macho' },
  estrella: { id: 11, arete_id: 'MX-4003', nombre_alias: 'Estrella', estado: 'vivo', sexo: 'hembra' },
};
// Simula asistenteEntidades: arete o nombre exacto; "Luna" es ambigua; lo demás no existe.
function pesoPorReferencia(llamadas) {
  return async (_db, args) => {
    llamadas.push(args.animal);
    const ref = args.animal.toLowerCase().replace(/^(la |el )?(vaca|toro|animal) /, '').replace(/^#/, '');
    if (ref === 'luna') {
      throw Object.assign(new Error('Hay 2 animales llamados “Luna”.'), { code: 'REFERENCIA_AMBIGUA', referencia: args.animal, opcionesEtiquetadas: [{ etiqueta: 'Luna · arete 123', valor: '123' }, { etiqueta: 'Luna · arete 418', valor: '418' }] });
    }
    const animal = Object.values(ANIMALES).find((a) => a.nombre_alias.toLowerCase() === ref || a.arete_id.toLowerCase() === ref);
    if (!animal) throw Object.assign(new Error(`No encontré un animal identificado como “${args.animal}”.`), { code: 'ANIMAL_NO_ENCONTRADO', referencia: args.animal });
    return { alcance: 'animal', estado: 'un_pesaje', animal, ultimo: { fecha: '2026-09-20', peso_kg: '400.00' }, historial: [{ fecha: '2026-09-20', peso_kg: '400.00' }] };
  };
}

async function cadena(preguntas) {
  let contexto = null;
  const respuestas = [];
  for (const mensaje of preguntas) {
    const r = await conversarConsultivo({ mensaje, contexto, usuario: admin, db: {}, ahora, telemetria, gemini: sinGemini });
    respuestas.push(r);
    contexto = r._contexto ? contextoDe(r) : null;
  }
  return respuestas;
}

test('P9.2.1 cierre: una pregunta completa con otra entidad explícita reemplaza al contexto (0 llamadas a Gemini)', async () => {
  const llamadas = [];
  const restaurar = conEjecutor('consultar_peso', pesoPorReferencia(llamadas));
  try {
    // Larra → Julio
    let [primera, segunda] = await cadena(['¿Qué pesaje tiene la vaca Larra?', 'Y que pesaje tiene la vaca Julio']);
    assert.match(primera.texto, /^Larra \(#MX-7001\) pesa 400 kg/);
    assert.match(segunda.texto, /^Julio \(#MX-7002\) pesa 400 kg/);
    assert.deepEqual(llamadas.splice(0), ['la vaca Larra', 'la vaca Julio']);
    // Estrella → Julio
    [primera, segunda] = await cadena(['¿Cuánto pesa Estrella?', 'Y cuánto pesa Julio?']);
    assert.match(primera.texto, /^Estrella/);
    assert.match(segunda.texto, /^Julio/);
    assert.deepEqual(llamadas.splice(0), ['Estrella', 'Julio']);
    // Arete → otro animal por nombre
    [primera, segunda] = await cadena(['Peso de MX-4003', 'Y el peso de Larra']);
    assert.match(primera.texto, /^Estrella \(#MX-4003\)/);
    assert.match(segunda.texto, /^Larra \(#MX-7001\)/);
    assert.deepEqual(llamadas.splice(0), ['MX-4003', 'Larra']);
    // Entidad ambigua tras otra: no elige y ofrece opciones.
    [, segunda] = await cadena(['¿Cuánto pesa Estrella?', 'Y que pesaje tiene la vaca Luna']);
    assert.match(segunda.texto, /Hay 2 animales llamados “Luna”\. ¿A cuál te refieres\?/);
    assert.deepEqual(segunda.opciones.map((o) => o.valor), ['123', '418']);
    assert.equal(segunda._contexto.pendiente.campo, 'animal');
    // Entidad inexistente tras otra: lo dice, sin datos del animal anterior.
    [, segunda] = await cadena(['¿Cuánto pesa Estrella?', 'Y que pesaje tiene la vaca Nadie']);
    assert.equal(segunda.texto, 'No encontré un animal identificado como “la vaca Nadie”.');
    assert.doesNotMatch(JSON.stringify(segunda), /Estrella/);
  } finally { restaurar(); }
});

test('P9.2.1 cierre: sin entidad nueva, una pregunta con "y" conserva el contexto', () => {
  const vivosEnObservacion = { tool: 'consultar_animales', argumentos: { modo: 'resumen', estado_salud: 'observacion' }, entidades: [] };
  const local = clasificar('Y cuántas vacas hay?');
  assert.equal(local.seguimientoPreferente, true);
  assert.deepEqual(resolverSeguimiento('Y cuántas vacas hay?', vivosEnObservacion, { catalogo: CATALOGO, ahora }).argumentos,
    { estado_salud: 'observacion', sexo: 'hembra', etapa: 'adulto', agrupar_por: 'categoria', modo: 'resumen' });
  assert.equal(clasificar('Y que pesaje tiene la vaca Julio').seguimientoPreferente, undefined, 'una entidad explícita no cede ante el contexto');
});
