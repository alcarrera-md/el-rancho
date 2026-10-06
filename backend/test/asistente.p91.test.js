const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATALOGO, conversarConsultivo, clasificarConsultaDeterminista, parecePreguntaDeDatos,
} = require('../src/asistenteConsultivo');
const { resolverSeguimiento, firmarContexto, verificarContexto } = require('../src/asistenteContexto');
const { resolverAnimal, resolverTrabajador, normalizarTexto } = require('../src/asistenteEntidades');

const actor = { id: 7, rol: 'Administrador' };
const telemetria = () => {};
const sinGemini = async () => assert.fail('no debe llamar a Gemini');

function conEjecutor(nombre, ejecutar) {
  const original = CATALOGO[nombre].ejecutar;
  CATALOGO[nombre].ejecutar = ejecutar;
  return () => { CATALOGO[nombre].ejecutar = original; };
}

function contextoDe(respuesta) {
  return verificarContexto(firmarContexto(respuesta._contexto, actor), actor);
}

const animalesFalsos = (llamadas) => async (_db, args) => {
  llamadas.push({ ...args });
  const total = args.sexo === 'hembra' ? 2 : 5;
  return {
    filtros: { ...args },
    resumen: { total, hembras: 2, machos: total - 2 },
    grupos: args.agrupar_por ? [{ grupo: 'vientre', total }] : undefined,
    items: args.modo === 'lista' ? [{ arete_id: 'A-1', nombre_alias: 'Luna', estado_salud: args.estado_salud || 'sano' }] : [],
  };
};

test('P9.1: "¿y cuántas son vacas?" conserva el filtro anterior y vuelve a consultar', async () => {
  const llamadas = [];
  const restaurar = conEjecutor('consultar_animales', animalesFalsos(llamadas));
  try {
    const primera = await conversarConsultivo({
      mensaje: '¿Qué animales están en observación?', usuario: actor, db: {}, telemetria, gemini: sinGemini,
    });
    const segunda = await conversarConsultivo({
      mensaje: '¿Y cuántas son vacas?', contexto: contextoDe(primera), usuario: actor, db: {}, telemetria, gemini: sinGemini,
    });
    assert.equal(llamadas.length, 2);
    assert.deepEqual(
      { sexo: llamadas[1].sexo, etapa: llamadas[1].etapa, estado_salud: llamadas[1].estado_salud, modo: llamadas[1].modo },
      { sexo: 'hembra', etapa: 'adulto', estado_salud: 'observacion', modo: 'resumen' },
    );
    assert.match(segunda.texto, /2 vacas vivas registradas \(en observación\)/);
  } finally { restaurar(); }
});

test('P9.1: "¿cuál de esos tiene tareas vencidas?" cruza tareas con el estado clínico anterior', async () => {
  const llamadasAnimales = [];
  const llamadasTareas = [];
  const restaurarAnimales = conEjecutor('consultar_animales', animalesFalsos(llamadasAnimales));
  const restaurarTareas = conEjecutor('consultar_tareas', async (_db, args) => {
    llamadasTareas.push(args);
    return { total: 1, vencidas: 1, mostradas: 1, items: [{ descripcion: 'Revisar', trabajador: 'Ana', fecha_limite: '2026-09-20', animal_arete: 'A-1', vencida: true }] };
  });
  try {
    const primera = await conversarConsultivo({ mensaje: 'Muéstrame los animales en observación', usuario: actor, db: {}, telemetria, gemini: async () => ({ functionCall: { name: 'consultar_animales', args: { modo: 'lista', estado_salud: 'observacion' } } }) });
    assert.equal(primera._contexto.argumentos.estado_salud, 'observacion');
    const segunda = await conversarConsultivo({ mensaje: '¿Cuál de esos tiene tareas vencidas?', contexto: contextoDe(primera), usuario: actor, db: {}, telemetria, gemini: sinGemini });
    assert.deepEqual(llamadasTareas[0], { estado: 'vencida', estado_salud_animal: 'observacion', limite: 25 });
    assert.match(segunda.texto, /1 tarea/);
  } finally { restaurarAnimales(); restaurarTareas(); }
});

test('P9.1: una pregunta completa no hereda filtros del contexto', async () => {
  const llamadas = [];
  const restaurar = conEjecutor('consultar_animales', animalesFalsos(llamadas));
  try {
    const contexto = verificarContexto(firmarContexto({ tool: 'consultar_animales', argumentos: { estado_salud: 'enfermo' }, entidades: [] }, actor), actor);
    await conversarConsultivo({ mensaje: '¿Cuántas vacas hay?', contexto, usuario: actor, db: {}, telemetria, gemini: sinGemini });
    assert.equal(llamadas[0].estado_salud, undefined);
  } finally { restaurar(); }
});

test('P9.1: seguimientos sin herramienta nunca responden con cifras sin evidencia', async () => {
  assert.equal(parecePreguntaDeDatos('¿Y cuáles son?'), true);
  assert.equal(parecePreguntaDeDatos('¿Quiénes?'), true);
  const contexto = verificarContexto(firmarContexto({ tool: 'consultar_clima', argumentos: { dia: 'hoy' }, entidades: [] }, actor), actor);
  const respuesta = await conversarConsultivo({
    mensaje: 'Explícamelo mejor', contexto, usuario: actor, db: {}, telemetria,
    gemini: async () => ({ text: JSON.stringify({ texto: 'Son 8 animales.' }) }),
  });
  assert.match(respuesta.texto, /Todavía no puedo calcular eso/);
});

test('P9.1: el prompt recibe la consulta verificada anterior sin cifras', async () => {
  let prompt = '';
  const contexto = verificarContexto(firmarContexto({ tool: 'consultar_corrales', argumentos: {}, entidades: [{ tipo: 'corral', valor: 'id:3', etiqueta: 'Norte' }] }, actor), actor);
  await conversarConsultivo({
    mensaje: '¿Y qué pasa con ese corral?', contexto, usuario: actor, db: {}, telemetria,
    gemini: async (contents) => { prompt = contents[0].parts[0].text; return { text: JSON.stringify({ texto: 'x' }) }; },
  });
  assert.match(prompt, /Última consulta verificada: consultar_corrales/);
  assert.match(prompt, /corral Norte \(usa "id:3"\)/);
});

test('P9.1 typos: tolera transposiciones y acentos sin confundir palabras cercanas', () => {
  assert.equal(clasificarConsultaDeterminista('Cauntas vacas hay?').intencion, 'vacas');
  assert.equal(clasificarConsultaDeterminista('Que animales estan enfermos?').intencion, 'animales_enfermos');
  assert.equal(clasificarConsultaDeterminista('¿Qué animales están en observación?').intencion, 'animales_observacion');
  // vaca / vacía
  assert.equal(clasificarConsultaDeterminista('¿Cuántas vacías hay?'), null);
  assert.equal(clasificarConsultaDeterminista('¿Cuántas vacas están vacías?'), null);
  // toro / toros: un toro concreto no es el conteo de toros
  // (P9.2: "el toro 51" es un animal concreto y abre su ficha; nunca el conteo de toros.)
  assert.equal(clasificarConsultaDeterminista('¿Qué pasa con el toro 51?').tool, 'consultar_ficha_animal');
  assert.notEqual(clasificarConsultaDeterminista('¿Qué pasa con el toro 51?').intencion, 'toros');
  assert.equal(clasificarConsultaDeterminista('¿Cuántos toros hay?').intencion, 'toros');
  // parto / aborto
  assert.equal(clasificarConsultaDeterminista('¿Cuántas parieron este año?').intencion, 'partos_anio');
  assert.equal(clasificarConsultaDeterminista('¿Cuántas abortaron este año?'), null);
  // alimento / medicamento
  assert.equal(clasificarConsultaDeterminista('¿Qué alimento se está acabando?').intencion, 'alimento_bajo');
  assert.equal(clasificarConsultaDeterminista('¿Qué medicamento se está acabando?'), null);
  // seguimiento: "vacías" nunca se convierte en "vacas"
  const contexto = { tool: 'consultar_animales', argumentos: {}, entidades: [] };
  assert.equal(resolverSeguimiento('¿Y vacías?', contexto, { catalogo: CATALOGO }), null);
  assert.equal(resolverSeguimiento('¿Y vacas?', contexto, { catalogo: CATALOGO }).sustantivo, 'vacas');
});

test('P9.1 seguimientos: lista reproductiva, periodo y opciones', () => {
  const catalogo = CATALOGO;
  const preñadas = { tool: 'consultar_resumen_reproductivo', argumentos: { metricas: ['prenadas'], periodo: 'anio_actual' }, entidades: [] };
  assert.deepEqual(resolverSeguimiento('¿Y cuáles son?', preñadas, { catalogo }), {
    intencion: 'seguimiento_lista', tool: 'listar_detalle_reproductivo', argumentos: { periodo: 'anio_actual', metrica: 'prenadas', limite: 25 },
  });
  // Dos métricas: no hay un único conjunto que listar.
  assert.equal(resolverSeguimiento('¿Y cuáles son?', { ...preñadas, argumentos: { metricas: ['prenadas', 'vacias'] } }, { catalogo }), null);
  // El periodo solo aplica a tools que lo aceptan; la ficha de un animal no tiene versión histórica ni explicación genérica.
  assert.equal(resolverSeguimiento('¿Y el mes pasado?', { tool: 'consultar_ficha_animal', argumentos: { identificador: '123' }, entidades: [] }, { catalogo }), null);
  const pendiente = { tool: null, argumentos: {}, entidades: [], pendiente: { tool: 'consultar_ficha_animal', argumentos: {}, campo: 'identificador', opciones: [{ etiqueta: 'Luna · arete 123', valor: '123' }, { etiqueta: 'Luna · arete 418', valor: '418' }] } };
  assert.equal(resolverSeguimiento('#418', pendiente, { catalogo }).argumentos.identificador, '418');
  assert.equal(resolverSeguimiento('la del arete 123', pendiente, { catalogo }).argumentos.identificador, '123');
  assert.equal(resolverSeguimiento('la segunda', pendiente, { catalogo }).argumentos.identificador, '418');
  assert.equal(resolverSeguimiento('999', pendiente, { catalogo }), null, 'una opción inexistente no se adivina');
});

test('P9.1 entidades: niveles de coincidencia, prefijos, acentos y ambigüedad etiquetada', async () => {
  assert.equal(normalizarTexto('  Vacía  Ñandú '), 'vacia nandu');
  const consultas = [];
  const db = { query: async (sql, valores) => {
    consultas.push({ sql, valores });
    return { rows: [
      { id: 1, arete_id: '123', nombre_alias: 'Luna', sexo: 'hembra', estado: 'vivo', nivel: 2 },
      { id: 2, arete_id: '418', nombre_alias: 'Luna', sexo: 'hembra', estado: 'vendido', nivel: 2 },
      { id: 3, arete_id: '500', nombre_alias: 'Lunita', sexo: 'hembra', estado: 'vivo', nivel: 4 },
    ] };
  } };
  await assert.rejects(resolverAnimal(db, 'la vaca Luna'), (error) => {
    assert.equal(error.code, 'REFERENCIA_AMBIGUA');
    assert.equal(error.message, 'Hay 2 animales llamados “la vaca Luna”.');
    assert.deepEqual(error.opcionesEtiquetadas, [{ etiqueta: 'Luna · arete 123', valor: '123' }, { etiqueta: 'Luna · arete 418 · vendido', valor: '418' }]);
    return true;
  });
  // Parámetros: variante literal y sin prefijo; nada del texto se concatena al SQL.
  assert.deepEqual(consultas[0].valores[1], ['la vaca luna', 'luna']);
  assert.equal(consultas[0].sql.includes('Luna'), false);

  const unico = { query: async () => ({ rows: [{ id: 9, arete_id: '248', nombre_alias: null, nivel: 1 }, { id: 248, arete_id: 'X', nombre_alias: null, nivel: 3 }] }) };
  assert.equal((await resolverAnimal(unico, 'vaca #248')).id, 9, 'el arete manda sobre el ID interno');

  const vacio = { query: async () => ({ rows: [] }) };
  await assert.rejects(resolverTrabajador(vacio, 'Pedro'), (e) => e.code === 'TRABAJADOR_NO_ENCONTRADO');
});

test('P9.1 tareas: un trabajador inexistente se informa en lugar de responder 0 tareas', async () => {
  const db = { query: async (sql) => (/FROM trabajador/.test(sql) ? { rows: [] } : { rows: [{ total: 0 }] }) };
  const respuesta = await conversarConsultivo({
    mensaje: '¿Qué tareas tiene Pedro?', usuario: actor, db, telemetria,
    gemini: async () => ({ functionCall: { name: 'consultar_tareas', args: { trabajador: 'Pedro' } } }),
  });
  assert.equal(respuesta.texto, 'No encontré un trabajador llamado “Pedro”.');
});

// --- Regresiones de UX posteriores a las pruebas manuales de P9.1 -------------

test('P9.1 UX: "¿y el mes pasado?" sobre el estado actual explica que no hay reconstrucción histórica', async () => {
  const llamadas = [];
  const restaurar = conEjecutor('consultar_animales', animalesFalsos(llamadas));
  try {
    const primera = await conversarConsultivo({ mensaje: '¿Cuántas vacas tengo?', usuario: actor, db: {}, telemetria, gemini: sinGemini });
    const segunda = await conversarConsultivo({ mensaje: '¿Y el mes pasado?', contexto: contextoDe(primera), usuario: actor, db: {}, telemetria, gemini: sinGemini });
    assert.equal(segunda.texto, 'No puedo determinar cuántas vacas había el mes pasado porque esta consulta representa el estado actual del hato y todavía no existe una reconstrucción histórica por fecha.');
    assert.equal(llamadas.length, 1, 'no se vuelve a consultar ni se reutiliza la cifra actual');
    assert.deepEqual(segunda.acciones, []);
    assert.equal(segunda._contexto.tool, 'consultar_animales', 'el contexto se conserva para seguir preguntando');
    const tercera = await conversarConsultivo({ mensaje: '¿Y cuáles son?', contexto: contextoDe(segunda), usuario: actor, db: {}, telemetria, gemini: sinGemini });
    assert.equal(llamadas.at(-1).modo, 'lista');
    assert.ok(tercera.lista.length);
  } finally { restaurar(); }
  const corrales = { tool: 'consultar_corrales', argumentos: {}, entidades: [] };
  assert.match(resolverSeguimiento('¿y el año pasado?', corrales, { catalogo: CATALOGO }).texto, /^No puedo determinar cuál era la ocupación de los corrales el año pasado porque esta consulta representa el estado actual de los corrales/);
  assert.equal(resolverSeguimiento('¿y hoy?', corrales, { catalogo: CATALOGO }).tool, 'consultar_corrales', '"hoy" es la misma consulta');
});

test('P9.1 UX: el texto del modelo llega sin Markdown ni referencias HTML en campos de texto plano', async () => {
  const restaurar = conEjecutor('consultar_corrales', async () => ({ filtros: {}, total_corrales: 1, corrales: [{ id: 4, nombre: 'Corral Toros', ocupacion: 3, capacidad_maxima: 4, espacio_disponible: 1, porcentaje_ocupacion: '75.0' }], mas_lleno: { id: 4, nombre: 'Corral Toros', ocupacion: 3, capacidad_maxima: 4, porcentaje_ocupacion: '75.0' } }));
  let ronda = 0;
  try {
    const respuesta = await conversarConsultivo({
      mensaje: '¿Cómo está la ocupación del corral de toros?', usuario: actor, db: {}, telemetria,
      gemini: async () => (++ronda === 1
        ? { functionCall: { name: 'consultar_corrales', args: {} } }
        : { text: JSON.stringify({ texto: 'El **Corral Toros** est&aacute; al 75&#37;.', destacado: { valor: '**75%**', etiqueta: '&#x4F;cupación de Corral Toros' }, lista: ['&lt;b&gt;3 de 4&lt;/b&gt;'] }) }),
    });
    assert.deepEqual(respuesta.destacado, { valor: '75%', etiqueta: 'Ocupación de Corral Toros' });
    assert.equal(respuesta.texto, 'El **Corral Toros** está al 75%.', 'solo texto conserva negritas');
    assert.deepEqual(respuesta.lista, ['3 de 4']);
    assert.doesNotMatch(JSON.stringify(respuesta), /&#|&[a-z]+;/);
  } finally { restaurar(); }
  // Una sola decodificación: "&amp;#x4F;" queda como texto literal "&#x4F;", no como "O".
  const { normalizarRespuestaModelo } = require('../src/asistenteConsultivo');
  assert.equal(normalizarRespuestaModelo({ texto: 'a &amp;#x4F; b' }).texto, 'a &#x4F; b');
});

test('P9.1 UX: drill-down solo con conjunto real, rutas válidas y sin duplicados', () => {
  const { accionesDesdeConsultas } = require('../src/asistenteConsultivo');
  const sinDatos = [
    { nombre: 'consultar_resumen_reproductivo', resultado: { filters: { periodo: 'anio_actual' }, metrics: {
      partos: { etiqueta: 'Partos reales', valor: 0 },
      servicios: { etiqueta: 'Servicios registrados', valor: 0 },
      prenadas: { etiqueta: 'Preñadas confirmadas', valor: null, estado: 'datos_insuficientes' },
    } } },
    { nombre: 'consultar_animales', resultado: { resumen: { total: 0 } } },
    { nombre: 'consultar_tareas', resultado: { total: 0, items: [] } },
    { nombre: 'consultar_finanzas', resultado: { metrica: 'ventas', cantidad: 0, total: '0' } },
  ];
  assert.deepEqual(accionesDesdeConsultas(sinDatos), [], 'sin datos no hay "Ver partos realesVer servicios registradosVer animales"');

  const conDatos = accionesDesdeConsultas([
    { nombre: 'consultar_resumen_reproductivo', resultado: { filters: { periodo: 'anio_actual' }, metrics: { partos: { etiqueta: 'Partos reales', valor: 2 }, servicios: { etiqueta: 'Servicios registrados', valor: 0 } } } },
    { nombre: 'consultar_animales', resultado: { resumen: { total: 5 } } },
    { nombre: 'consultar_animales', resultado: { resumen: { total: 3 } } },
  ]);
  assert.deepEqual(conDatos.map((a) => a.etiqueta), ['Ver partos reales', 'Ver animales']);

  // Toda ruta producida existe en el router del frontend.
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../frontend/src/App.jsx'), 'utf8');
  const rutas = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((r) => r !== '*');
  const todas = accionesDesdeConsultas([
    { nombre: 'consultar_animales', resultado: { resumen: { total: 1 } } },
    { nombre: 'consultar_atencion', resultado: { resumen: { animales: 1 } } },
    { nombre: 'consultar_corrales', resultado: { total_corrales: 1 } },
    { nombre: 'consultar_inventario', resultado: { total_productos: 1 } },
  ]).concat(accionesDesdeConsultas([
    { nombre: 'consultar_tareas', resultado: { total: 1 } },
    { nombre: 'consultar_movimientos', resultado: { total: 1 } },
    { nombre: 'consultar_finanzas', resultado: { metrica: 'compras_animales', cantidad: 1 } },
    { nombre: 'consultar_ficha_animal', resultado: { animal: { id: 42, arete_id: '123' } } },
  ]), accionesDesdeConsultas([
    { nombre: 'consultar_clima', resultado: { pronostico: { etiqueta: 'Hoy' } } },
    { nombre: 'listar_detalle_reproductivo', resultado: { total: 1 } },
  ]));
  assert.ok(todas.length >= 9);
  for (const accion of todas) {
    const ruta = accion.ruta.split('?')[0];
    const existe = rutas.some((patron) => new RegExp(`^${patron.replace(/:[a-z]+/g, '[^/]+')}$`).test(ruta));
    assert.ok(existe, `ruta inexistente: ${accion.ruta}`);
  }
});
