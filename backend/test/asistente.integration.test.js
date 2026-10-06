const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');

cargarEntornoPruebas();
const db = require('../src/db');
const { crearServicio, registrarDiagnostico, registrarParto } = require('../src/reproduccionService');
const { obtenerResumenAnalitico, obtenerDetalleMetrica } = require('../src/reproduccionAnaliticaService');
const { ejecutarTool } = require('../src/asistenteConsultivo');

const ahora = new Date('2026-09-17T12:00:00Z');
const usuario = { id: 1, rol: 'Auditor' };
const telemetria = () => {};
let corral;
let toro;
let prenada;
let pendiente;
let parida;
let vacia;
let dudosa;
let corralSecundario;

async function crearAnimal(arete, sexo, alias, categoria = sexo === 'hembra' ? 'vientre' : 'reproductor') {
  return (await db.query(`INSERT INTO animal (arete_id,nombre_alias,sexo,origen,estado,categoria,fecha_nacimiento,corral_actual_id)
    VALUES ($1,$2,$3,'nacimiento','vivo',$4,'2020-01-01',$5) RETURNING *`, [arete, alias, sexo, categoria, corral.id])).rows[0];
}

test.before(async () => {
  corral = (await db.query(`INSERT INTO corral (nombre,capacidad_maxima) VALUES ('IA P5 Norte',100) RETURNING *`)).rows[0];
  corralSecundario = (await db.query(`INSERT INTO corral (nombre,capacidad_maxima) VALUES ('IA P5 Sur',2) RETURNING *`)).rows[0];
  toro = await crearAnimal('IA-T51', 'macho', 'Semental P5');
  prenada = await crearAnimal('IA-V248', 'hembra', 'Luna P5');
  pendiente = await crearAnimal('IA-V249', 'hembra', 'Pendiente P5');
  parida = await crearAnimal('IA-V250', 'hembra', 'Parida P5');
  vacia = await crearAnimal('IA-V251', 'hembra', 'Vacía P5');
  dudosa = await crearAnimal('IA-V252', 'hembra', 'Revisión P5');

  const servicioPrenada = await crearServicio(db, { hembra_id: prenada.id, macho_id: toro.id, tipo: 'natural', fecha: '2026-06-01' });
  await registrarDiagnostico(db, servicioPrenada.ciclo.id, { servicio_id: servicioPrenada.servicio.id, fecha: '2026-07-10', metodo: 'palpacion', resultado: 'prenada' });
  await crearServicio(db, { hembra_id: pendiente.id, macho_id: toro.id, tipo: 'natural', fecha: '2026-07-01' });
  const servicioParida = await crearServicio(db, { hembra_id: parida.id, macho_id: toro.id, tipo: 'natural', fecha: '2025-06-01' });
  await registrarDiagnostico(db, servicioParida.ciclo.id, { servicio_id: servicioParida.servicio.id, fecha: '2025-07-10', metodo: 'ecografia', resultado: 'prenada' });
  await registrarParto(db, servicioParida.ciclo.id, { fecha_real: '2026-03-10', resultado: 'parto', crias: [{ sexo_capturado: 'hembra', estado_nacimiento: 'vivo' }] });
  const servicioVacia = await crearServicio(db, { hembra_id: vacia.id, macho_id: toro.id, tipo: 'natural', fecha: '2026-04-01' });
  await registrarDiagnostico(db, servicioVacia.ciclo.id, { servicio_id: servicioVacia.servicio.id, fecha: '2026-05-10', metodo: 'palpacion', resultado: 'vacia' });
  const servicioDudosa = await crearServicio(db, { hembra_id: dudosa.id, macho_id: toro.id, tipo: 'natural', fecha: '2026-05-01' });
  await registrarDiagnostico(db, servicioDudosa.ciclo.id, { servicio_id: servicioDudosa.servicio.id, fecha: '2026-06-10', metodo: 'palpacion', resultado: 'dudoso', fecha_siguiente_revision: '2026-06-20' });
  await crearAnimal('IA-A1', 'hembra', 'Ambigua P5');
  await crearAnimal('IA-A2', 'hembra', 'Ambigua P5');
  await db.query(`INSERT INTO animal (arete_id,nombre_alias,sexo,origen,estado,categoria,fecha_nacimiento,corral_actual_id) VALUES ('IA-S1','Sur uno','hembra','nacimiento','vivo','vientre','2020-01-01',$1)`, [corralSecundario.id]);
  await db.query(`INSERT INTO insumo (nombre,tipo,unidad_medida,stock_actual,stock_minimo,fecha_caducidad) VALUES ('Heno IA','alimento','kg',320,50,'2027-01-01'),('Mineral IA','alimento','kg',18,20,'2027-01-01'),('Vacuna IA','vacuna','dosis',5,2,'2026-09-30')`);
});

test.after(async () => db.pool.end());

test('mejoras IA: SQL real de agrupaciones, etapas, estados y referencias inexistentes', async () => {
  const contexto = { usuario, db, ahora, telemetria };
  const grupos = await ejecutarTool('consultar_animales', { agrupar_por: 'corral' }, contexto);
  const directo = (await db.query(`SELECT COALESCE(c.nombre,'Sin corral') grupo,COUNT(*)::int total FROM animal a LEFT JOIN corral c ON c.id=a.corral_actual_id WHERE a.estado='vivo' GROUP BY 1`)).rows;
  assert.deepEqual(
    Object.fromEntries(grupos.grupos.map((g) => [g.grupo, g.total])),
    Object.fromEntries(directo.map((g) => [g.grupo, g.total])),
  );
  const adultos = await ejecutarTool('consultar_animales', { etapa: 'adulto', corral: 'IA P5 Norte' }, contexto);
  const adultosDirecto = (await db.query(`SELECT COUNT(*)::int total FROM animal WHERE estado='vivo' AND corral_actual_id=$1 AND categoria IN ('engorde','vientre','reproductor','descarte')`, [corral.id])).rows[0].total;
  assert.equal(adultos.resumen.total, adultosDirecto);
  assert.equal(adultos.resumen.hembras_adultas + adultos.resumen.machos_adultos, adultosDirecto);

  await db.query(`INSERT INTO animal (arete_id,sexo,origen,estado,categoria,fecha_nacimiento,fecha_baja) VALUES ('IA-M1','macho','nacimiento','muerto','engorde','2021-01-01','2026-09-01')`);
  const muertos = await ejecutarTool('consultar_animales', { estado: 'muerto' }, contexto);
  const muertosDirecto = (await db.query(`SELECT COUNT(*)::int total FROM animal WHERE estado='muerto'`)).rows[0].total;
  assert.equal(muertos.resumen.total, muertosDirecto);
  assert.ok(muertos.resumen.total >= 1);

  await assert.rejects(ejecutarTool('consultar_animales', { corral: 'Corral que no existe' }, contexto), (e) => e.code === 'CORRAL_NO_ENCONTRADO');
  await assert.rejects(ejecutarTool('consultar_animales', { raza: 'Raza que no existe' }, contexto), (e) => e.code === 'RAZA_NO_ENCONTRADA');
});

test('regresión IA: vacas y toros se cuentan por separado con SQL real', async () => {
  const contexto = { usuario, db, ahora, telemetria };
  const vacas = await ejecutarTool('consultar_animales', { sexo: 'hembra', etapa: 'adulto', agrupar_por: 'categoria' }, contexto);
  const toros = await ejecutarTool('consultar_animales', { sexo: 'macho', etapa: 'adulto', agrupar_por: 'categoria' }, contexto);
  const directo = (await db.query(`SELECT sexo,COUNT(*)::int total FROM animal WHERE estado='vivo' AND categoria IN ('engorde','vientre','reproductor','descarte') GROUP BY sexo`)).rows;
  assert.equal(vacas.resumen.total, directo.find((f) => f.sexo === 'hembra')?.total || 0);
  assert.equal(toros.resumen.total, directo.find((f) => f.sexo === 'macho')?.total || 0);
  assert.equal(vacas.resumen.machos, 0);
  assert.equal(vacas.grupos.reduce((suma, g) => suma + g.total, 0), vacas.resumen.total);
});

test('mejoras IA: inventario agrupa por tipo y unidad sin mezclar kg con dosis', async () => {
  const contexto = { usuario, db, ahora, telemetria };
  const inventario = await ejecutarTool('consultar_inventario', {}, contexto);
  const directo = (await db.query(`SELECT tipo,LOWER(TRIM(unidad_medida)) unidad,SUM(stock_actual)::numeric total FROM insumo WHERE activo=true GROUP BY 1,2`)).rows;
  for (const fila of directo) {
    const obtenido = inventario.totales_por_unidad.find((t) => t.tipo === fila.tipo && t.unidad === fila.unidad);
    assert.equal(Number(obtenido.stock_total), Number(fila.total));
  }
  assert.ok(inventario.totales_por_unidad.some((t) => t.tipo === 'vacuna' && t.unidad === 'dosis'));
  const bajos = await ejecutarTool('consultar_inventario', { tipo: 'alimento', estado: 'bajo' }, contexto);
  assert.ok(bajos.items.some((i) => i.nombre === 'Mineral IA'));
  assert.equal(bajos.items.some((i) => i.nombre === 'Heno IA'), false);
});

test('mejoras IA: tareas cruzadas con observación, movimientos por semana y ficha del animal', async () => {
  const contexto = { usuario: { id: 1, rol: 'Administrador' }, db, ahora, telemetria };
  const trabajador = (await db.query(`INSERT INTO trabajador (nombre,activo) VALUES ('Responsable IA',true) RETURNING id`)).rows[0];
  await db.query(`UPDATE animal SET estado_salud='observacion' WHERE id=$1`, [vacia.id]);
  await db.query(`INSERT INTO asignacion_tarea (trabajador_id,titulo,descripcion,fecha,animal_id,estado) VALUES
    ($1,'Revisar IA','Revisar vacía IA','2026-09-10',$2,'pendiente'),
    ($1,'Pesar IA','Pesar preñada IA','2026-09-30',$3,'pendiente')`, [trabajador.id, vacia.id, prenada.id]);
  const cruzadas = await ejecutarTool('consultar_tareas', { estado: 'pendiente', estado_salud_animal: 'observacion' }, contexto);
  assert.ok(cruzadas.items.every((t) => t.animal_estado_salud === 'observacion'));
  assert.ok(cruzadas.items.some((t) => t.animal_id === vacia.id));
  const directo = (await db.query(`SELECT COUNT(*)::int total FROM asignacion_tarea a JOIN animal an ON an.id=a.animal_id WHERE a.estado IN ('pendiente','en_progreso') AND an.estado='vivo' AND an.estado_salud='observacion'`)).rows[0].total;
  assert.equal(cruzadas.total, directo);

  await db.query(`INSERT INTO movimiento_corral (animal_id,corral_origen,corral_destino,fecha,motivo) VALUES ($1,$2,$3,'2026-09-15','Prueba IA')`, [dudosa.id, corral.id, corralSecundario.id]);
  const semana = await ejecutarTool('consultar_movimientos', { periodo: 'esta_semana' }, contexto);
  assert.deepEqual(semana.rango, { periodo: 'esta_semana', desde: '2026-09-14', hasta: '2026-09-20' });
  const semanaDirecto = (await db.query(`SELECT COUNT(*)::int total FROM movimiento_corral WHERE fecha BETWEEN '2026-09-14' AND '2026-09-20'`)).rows[0].total;
  assert.equal(semana.total, semanaDirecto);
  assert.ok(semana.items.some((m) => m.animal_id === dudosa.id && m.destino === 'IA P5 Sur'));

  const ficha = await ejecutarTool('consultar_ficha_animal', { identificador: 'IA-V251' }, contexto);
  assert.equal(ficha.animal.id, vacia.id);
  assert.equal(ficha.animal.estado_salud, 'observacion');
  assert.deepEqual(ficha.tareas, { pendientes: 1, vencidas: 1 });

  const atencion = await ejecutarTool('consultar_atencion', {}, contexto);
  const item = atencion.items.find((a) => a.id === vacia.id);
  // P9.3: el estado de salud se separa en enfermo/observacion porque tienen prioridades distintas.
  assert.deepEqual(item.motivos.map((m) => m.tipo).sort(), ['observacion', 'tarea_vencida']);
  assert.ok(atencion.resumen.en_observacion >= 1);
  await assert.rejects(ejecutarTool('consultar_ficha_animal', { identificador: 'Ambigua P5' }, contexto), (e) => e.code === 'REFERENCIA_AMBIGUA');
});

test('mejoras IA: preñadas por corral coinciden con el conteo filtrado por corral', async () => {
  const contexto = { usuario, db, ahora, telemetria };
  const agrupado = await ejecutarTool('consultar_resumen_reproductivo', { metricas: ['prenadas', 'pendientes'], agrupar_por: 'corral' }, contexto);
  const norte = await ejecutarTool('consultar_resumen_reproductivo', { metricas: ['prenadas', 'pendientes'], corral: String(corral.id) }, contexto);
  const fila = agrupado.por_corral.find((f) => f.corral === 'IA P5 Norte');
  assert.equal(fila.prenadas || 0, norte.metrics.prenadas.valor);
  assert.equal(fila.pendientes || 0, norte.metrics.pendientes.valor);
});

test('mejoras IA: egresos coinciden con la suma directa de sus componentes', async () => {
  const categoria = (await db.query('SELECT id FROM categoria_gasto ORDER BY id LIMIT 1')).rows[0];
  await db.query(`INSERT INTO gasto_general (categoria_id,fecha,monto,descripcion) VALUES ($1,'2026-09-05',1250.50,'Gasto IA')`, [categoria.id]);
  const auditor = await ejecutarTool('consultar_finanzas', { metrica: 'egresos', periodo: 'mes_actual' }, { usuario: { id: 1, rol: 'Auditor' }, db, ahora, telemetria });
  const directo = (await db.query(`SELECT
      (SELECT COALESCE(SUM(costo_total),0) FROM compra_insumo WHERE fecha BETWEEN '2026-09-01' AND '2026-09-30')
    + (SELECT COALESCE(SUM(precio),0) FROM compra_animal WHERE fecha BETWEEN '2026-09-01' AND '2026-09-30')
    + (SELECT COALESCE(SUM(monto),0) FROM gasto_general WHERE fecha BETWEEN '2026-09-01' AND '2026-09-30')
    + (SELECT COALESCE(SUM(monto),0) FROM costo_reproductivo WHERE fecha BETWEEN '2026-09-01' AND '2026-09-30' AND gasto_general_id IS NULL AND compra_insumo_id IS NULL) total`)).rows[0].total;
  assert.equal(Number(auditor.total), Number(directo));
  const trabajador = await ejecutarTool('consultar_finanzas', { metrica: 'egresos', periodo: 'mes_actual' }, { usuario: { id: 2, rol: 'Trabajador' }, db, ahora, telemetria });
  assert.equal(trabajador.desglose.some((d) => d.concepto === 'costos_reproductivos'), false);
});

test('tools IA coinciden exactamente con la capa analítica P4 para cifras y filtros', async () => {
  const filtros = { periodo: 'anio_actual', corral_id: corral.id };
  const esperado = await obtenerResumenAnalitico(db, filtros, { ahora });
  const obtenido = await ejecutarTool('consultar_resumen_reproductivo', {
    periodo: 'anio_actual', corral: String(corral.id), metricas: ['prenadas', 'vacias', 'pendientes', 'revision', 'partos', 'tasa_prenez'],
  }, { usuario, db, ahora, telemetria });
  for (const clave of ['prenadas', 'vacias', 'pendientes', 'revision', 'partos', 'tasa_prenez']) {
    assert.equal(obtenido.metrics[clave].valor, esperado.metrics[clave].valor);
    assert.equal(obtenido.metrics[clave].numerador, esperado.metrics[clave].numerador);
    assert.equal(obtenido.metrics[clave].denominador, esperado.metrics[clave].denominador);
    assert.equal('items' in obtenido.metrics[clave], false);
  }
  assert.equal(obtenido.metrics.partos.crias, 1);
});

test('drill-down conserva el mismo conjunto, filtros, paginación y cero resultados', async () => {
  const obtenido = await ejecutarTool('listar_detalle_reproductivo', {
    periodo: 'anio_actual', corral: 'IA P5 Norte', metrica: 'pendientes', pagina: 1, limite: 1,
  }, { usuario, db, ahora, telemetria });
  const esperado = await obtenerDetalleMetrica(db, { periodo: 'anio_actual', corral_id: corral.id }, 'pendientes', 1, 1, { ahora });
  assert.deepEqual(obtenido.items, esperado.items);
  assert.equal(obtenido.total, esperado.total);
  assert.equal(obtenido.items[0].animal_id, pendiente.id);

  const cero = await ejecutarTool('listar_detalle_reproductivo', {
    periodo: 'personalizado', desde: '2030-01-01', hasta: '2030-01-31', corral: String(corral.id), metrica: 'partos', pagina: 1, limite: 10,
  }, { usuario, db, ahora, telemetria });
  assert.equal(cero.total, 0);
  assert.deepEqual(cero.items, []);
});

test('periodos relativos se normalizan a fechas canónicas en backend', async () => {
  const resultado = await ejecutarTool('consultar_resumen_reproductivo', {
    periodo: 'proximos_30_dias', metricas: ['proximos_partos'], corral: String(corral.id),
  }, { usuario, db, ahora, telemetria });
  assert.equal(resultado.filters.periodo, 'personalizado');
  assert.equal(resultado.filters.desde, '2026-09-17');
  assert.equal(resultado.filters.hasta, '2026-10-17');
});

test('vaca concreta entrega ciclo, servicios, diagnóstico, toro, fecha e historial', async () => {
  const resultado = await ejecutarTool('consultar_vaca_reproductiva', { identificador: '#IA-V248' }, { usuario, db, ahora, telemetria });
  assert.equal(resultado.animal.id, prenada.id);
  assert.equal(resultado.ciclo_actual.servicios[0].macho_id, toro.id);
  assert.equal(resultado.ciclo_actual.diagnosticos.at(-1).resultado, 'prenada');
  assert.ok(resultado.ciclo_actual.estado_actual.fecha_parto_estimada);
  assert.equal(resultado.ciclos.length, 1);
});

test('perfil de semental reporta atribución, partos, crías y completitud sin ranking', async () => {
  const resultado = await ejecutarTool('consultar_semental_reproductivo', { identificador: toro.arete_id, periodo: 'personalizado', desde: '2025-01-01', hasta: '2026-12-31' }, { usuario, db, ahora, telemetria });
  assert.equal(resultado.item.id, toro.id);
  assert.equal(resultado.item.diagnosticos_positivos, 2);
  assert.equal(resultado.item.partos, 1);
  assert.equal(resultado.item.crias, 1);
  assert.ok(resultado.item.completitud.porcentaje < 100);
  assert.equal('ranking' in resultado.item, false);
});

test('animal inexistente y nombre ambiguo nunca eligen una coincidencia silenciosa', async () => {
  await assert.rejects(
    ejecutarTool('consultar_vaca_reproductiva', { identificador: 'No existe P5' }, { usuario, db, ahora, telemetria }),
    (error) => error.code === 'ANIMAL_NO_ENCONTRADO',
  );
  await assert.rejects(
    ejecutarTool('consultar_vaca_reproductiva', { identificador: 'Ambigua P5' }, { usuario, db, ahora, telemetria }),
    (error) => error.code === 'REFERENCIA_AMBIGUA' && error.opciones.length === 2,
  );
});

test('P5.1 global coincide con consultas deterministas para animales, corrales y stock', async () => {
  const contexto = { usuario, db, ahora, telemetria };
  const animales = await ejecutarTool('consultar_animales', { modo: 'lista', corral: 'IA P5 Norte', limite: 25 }, contexto);
  const totalDirecto = Number((await db.query(`SELECT COUNT(*) total FROM animal WHERE estado='vivo' AND corral_actual_id=$1`, [corral.id])).rows[0].total);
  assert.equal(animales.resumen.total, totalDirecto);
  assert.equal(animales.items.length, totalDirecto);

  const corrales = await ejecutarTool('consultar_corrales', {}, contexto);
  const directo = (await db.query(`SELECT c.id,ROUND(COUNT(a.id)*100.0/c.capacidad_maxima,1) porcentaje FROM corral c LEFT JOIN animal a ON a.corral_actual_id=c.id AND a.estado='vivo' WHERE c.activo=true GROUP BY c.id ORDER BY porcentaje DESC,c.nombre LIMIT 1`)).rows[0];
  assert.equal(corrales.mas_lleno.id, directo.id);
  assert.equal(Number(corrales.mas_lleno.porcentaje_ocupacion), Number(directo.porcentaje));

  const stock = await ejecutarTool('consultar_inventario', { tipo: 'alimento' }, contexto);
  // Los productos bajos o agotados se listan primero para que una lista limitada muestre lo urgente.
  assert.deepEqual(stock.items.filter((i) => / IA$/.test(i.nombre)).map((i) => [i.nombre, Number(i.stock_actual), i.unidad_medida]), [['Mineral IA',18,'kg'],['Heno IA',320,'kg']]);
});

test('P9.1 entidades con SQL real: acentos, prefijos, parciales, ambigüedad y trabajadores', async () => {
  const { resolverAnimal, resolverCorral, resolverTrabajador, resolverInsumo } = require('../src/asistenteEntidades');
  const contexto = { usuario: { id: 1, rol: 'Administrador' }, db, ahora, telemetria };
  // Sin acento, sin mayúsculas y con prefijo del ganadero.
  assert.equal((await resolverAnimal(db, 'vacia p5')).id, vacia.id);
  assert.equal((await resolverAnimal(db, 'la vaca IA-V248')).id, prenada.id);
  assert.equal((await resolverAnimal(db, 'LUNA P5')).id, prenada.id);
  // El ID interno solo cuenta si no hay arete o nombre que coincida.
  assert.equal((await resolverAnimal(db, `id:${pendiente.id}`)).id, pendiente.id);
  await assert.rejects(resolverAnimal(db, 'Ambigua P5'), (error) => {
    assert.equal(error.code, 'REFERENCIA_AMBIGUA');
    assert.deepEqual(error.opcionesEtiquetadas.map((o) => o.etiqueta), ['Ambigua P5 · arete IA-A1', 'Ambigua P5 · arete IA-A2']);
    return true;
  });
  // Semental: el filtro de sexo se respeta.
  await assert.rejects(resolverAnimal(db, 'IA-V248', { sexo: 'macho' }), (e) => e.code === 'ANIMAL_NO_ENCONTRADO');
  assert.equal((await resolverCorral(db, 'corral ia p5 sur')).id, corralSecundario.id);
  assert.equal((await resolverCorral(db, `id:${corral.id}`)).id, corral.id);

  const trabajador = (await db.query(`INSERT INTO trabajador (nombre,activo) VALUES ('Jesús Entidades IA',true),('Jesús Otro IA',true) RETURNING id`)).rows;
  await assert.rejects(resolverTrabajador(db, 'jesus'), (e) => e.code === 'REFERENCIA_AMBIGUA' && e.opcionesEtiquetadas.length === 2);
  assert.equal((await resolverTrabajador(db, 'jesus entidades ia')).id, trabajador[0].id);
  await assert.rejects(ejecutarTool('consultar_tareas', { trabajador: 'Nadie Inexistente IA' }, contexto), (e) => e.code === 'TRABAJADOR_NO_ENCONTRADO');

  assert.equal((await resolverInsumo(db, 'heno ia')).nombre, 'Heno IA');
  const soloHeno = await ejecutarTool('consultar_inventario', { insumo: 'Heno IA' }, contexto);
  assert.deepEqual(soloHeno.items.map((i) => i.nombre), ['Heno IA']);
  assert.equal((await resolverInsumo(db, 'mineral')).nombre, 'Mineral IA', 'parcial único');
  // Menos de 3 letras no se busca por parcial: no se adivina entre productos.
  await assert.rejects(ejecutarTool('consultar_inventario', { insumo: 'IA' }, contexto), (e) => e.code === 'INSUMO_NO_ENCONTRADO');
  await db.query(`INSERT INTO insumo (nombre,tipo,unidad_medida,stock_actual,stock_minimo) VALUES ('Sal mineral IA','alimento','kg',10,5)`);
  await assert.rejects(ejecutarTool('consultar_inventario', { insumo: 'mineral' }, contexto), (e) => e.code === 'REFERENCIA_AMBIGUA' && e.opcionesEtiquetadas.length === 2);
});

test('P9.2 salud, peso, condición, alertas y calendario con SQL real', async () => {
  const contexto = { usuario: { id: 1, rol: 'Administrador' }, db, ahora, telemetria };
  const nuevo = async (arete, alias, estadoSalud = 'sano') => (await db.query(`INSERT INTO animal (arete_id,nombre_alias,sexo,origen,estado,categoria,fecha_nacimiento,corral_actual_id,estado_salud,salud_fecha_inicio)
    VALUES ($1,$2,'hembra','nacimiento','vivo','vientre','2020-01-01',$3,$4,$5) RETURNING *`, [arete, alias, corral.id, estadoSalud, estadoSalud === 'sano' ? null : '2026-09-10'])).rows[0];
  const estrella = await nuevo('IA-E92', 'Estrella P92', 'enfermo');
  const solo = await nuevo('IA-S92', 'Un pesaje P92');
  await nuevo('IA-N92', 'Sin pesos P92');
  await db.query(`INSERT INTO pesaje (animal_id,fecha,peso_kg) VALUES ($1,'2026-08-20',498),($1,'2026-09-12',486),($2,'2026-09-01',300)`, [estrella.id, solo.id]);
  await db.query(`INSERT INTO condicion_corporal (animal_id,fecha,puntuacion) VALUES ($1,'2026-08-20',3),($1,'2026-09-12',2)`, [estrella.id]);
  await db.query(`INSERT INTO evento_salud (animal_id,tipo,enfermedad,fecha,proxima_dosis) VALUES
    ($1,'vacuna','Clostridiosis P92','2026-06-01','2026-09-19'),
    ($1,'vacuna','Rabia P92','2026-05-01','2026-09-10'),
    ($1,'tratamiento','Cojera P92','2026-09-11',NULL)`, [estrella.id]);

  // Peso de un animal: diferencia = reciente − anterior, calculada en backend.
  const peso = await ejecutarTool('consultar_peso', { animal: 'estrella p92' }, contexto);
  assert.equal(peso.estado, 'con_comparacion');
  assert.deepEqual([peso.ultimo.fecha, Number(peso.ultimo.peso_kg), peso.anterior.fecha, peso.diferencia_kg, peso.dias_entre_pesajes], ['2026-09-12', 486, '2026-08-20', -12, 23]);
  assert.equal((await ejecutarTool('consultar_peso', { animal: 'IA-S92' }, contexto)).estado, 'un_pesaje');
  assert.equal((await ejecutarTool('consultar_peso', { animal: 'IA-N92' }, contexto)).estado, 'sin_pesajes');

  // Hato: coincide con el cálculo directo sobre los dos pesajes más recientes.
  const bajaron = await ejecutarTool('consultar_peso', { direccion: 'bajada', limite: 25 }, contexto);
  const directo = (await db.query(`WITH p AS (SELECT p.animal_id,p.peso_kg,ROW_NUMBER() OVER (PARTITION BY p.animal_id ORDER BY p.fecha DESC,p.id DESC) rn
      FROM pesaje p JOIN animal a ON a.id=p.animal_id AND a.estado='vivo')
    SELECT COUNT(*)::int total FROM (SELECT animal_id FROM p GROUP BY animal_id
      HAVING MAX(peso_kg) FILTER (WHERE rn=1) < MAX(peso_kg) FILTER (WHERE rn=2)) x`)).rows[0].total;
  assert.equal(bajaron.resumen.bajaron, directo);
  assert.ok(bajaron.items.some((i) => i.animal_id === estrella.id && Number(i.diferencia) === -12));
  const periodo = await ejecutarTool('consultar_peso', { direccion: 'bajada', periodo: 'mes_actual' }, contexto);
  assert.equal(periodo.items.some((i) => i.animal_id === estrella.id), false, 'en septiembre Estrella solo tiene un pesaje: no hay comparación');

  // Condición corporal con la regla existente (≤ 2 delgada).
  const cc = await ejecutarTool('consultar_condicion_corporal', { animal: 'IA-E92' }, contexto);
  assert.deepEqual([cc.ultima.puntuacion, cc.anterior.puntuacion, cc.cambio, cc.clasificacion], [2, 3, -1, 'delgada']);
  const delgadas = await ejecutarTool('consultar_condicion_corporal', { filtro: 'delgada', limite: 25 }, contexto);
  assert.ok(delgadas.items.some((i) => i.animal_id === estrella.id));
  const bajo = await ejecutarTool('consultar_condicion_corporal', { filtro: 'bajo_puntuacion', limite: 25 }, contexto);
  assert.ok(bajo.items.some((i) => i.animal_id === estrella.id));

  // Salud: revisión, eventos y dosis con la fecha del rancho (2026-09-17).
  const revision = await ejecutarTool('consultar_salud', { enfoque: 'revision', limite: 25 }, contexto);
  const revisionDirecto = (await db.query(`SELECT COUNT(*)::int total FROM animal WHERE estado='vivo' AND estado_salud IN ('enfermo','observacion')`)).rows[0].total;
  assert.equal(revision.total, revisionDirecto);
  assert.ok(revision.items.some((i) => i.id === estrella.id && i.salud_fecha_inicio === '2026-09-10'));
  const eventos = await ejecutarTool('consultar_salud', { enfoque: 'eventos', animal: 'Estrella P92' }, contexto);
  assert.equal(eventos.total, 3);
  assert.equal(eventos.items[0].tipo, 'tratamiento', 'más reciente primero');
  const semana = await ejecutarTool('consultar_salud', { enfoque: 'dosis', ventana: 'esta_semana', tipo: 'vacuna', limite: 25 }, contexto);
  assert.deepEqual(semana.rango, { desde: '2026-09-17', hasta: '2026-09-20' });
  assert.ok(semana.items.some((d) => d.animal_id === estrella.id && d.proxima_dosis === '2026-09-19' && d.dias === 2));
  assert.equal(semana.items.some((d) => d.proxima_dosis === '2026-09-10'), false, 'una vencida no es próxima');
  const vencidas = await ejecutarTool('consultar_salud', { enfoque: 'dosis', ventana: 'vencidas', limite: 25 }, contexto);
  const vencidasDirecto = (await db.query(`SELECT COUNT(*)::int total FROM evento_salud es JOIN animal a ON a.id=es.animal_id AND a.estado='vivo' WHERE es.proxima_dosis < '2026-09-17'`)).rows[0].total;
  assert.equal(vencidas.total, vencidasDirecto);
  assert.ok(vencidas.items.some((d) => d.animal_id === estrella.id && d.proxima_dosis === '2026-09-10'));

  // Ficha consultiva en una sola tool.
  const ficha = await ejecutarTool('consultar_ficha_animal', { identificador: 'vaca IA-E92' }, contexto);
  assert.deepEqual(ficha.ultimos_pesajes.map((p) => p.fecha), ['2026-09-12', '2026-08-20']);
  assert.equal(ficha.condicion_corporal[0].puntuacion, 2);
  assert.deepEqual(ficha.proximas_dosis.map((d) => d.fecha), ['2026-09-19']);
  assert.equal(ficha.dosis_vencidas, 1);
  assert.equal(ficha.reproduccion.resumen, 'sin ciclo reproductivo abierto');
  const fichaPrenada = await ejecutarTool('consultar_ficha_animal', { identificador: 'IA-V248' }, contexto);
  assert.match(fichaPrenada.reproduccion.resumen, /^preñada \(diagnóstico 2026-07-10, parto estimado \d{4}-\d{2}-\d{2}\)$/);

  // Alertas: mismas fuentes; la cifra de vencidas coincide con el SQL directo.
  const alertas = await ejecutarTool('consultar_alertas', {}, contexto);
  assert.equal(alertas.alertas.find((a) => a.tipo === 'Vacuna vencida').total, vencidasDirecto);
  assert.ok(alertas.alertas.every((a) => ['critica', 'advertencia', 'info'].includes(a.severidad)));
  const criticas = await ejecutarTool('consultar_alertas', { severidad: 'critica' }, contexto);
  assert.ok(criticas.alertas.every((a) => a.severidad === 'critica'));

  // Calendario: mismo servicio que la pantalla, rango explícito y límite.
  const { obtenerEventosCalendario } = require('../src/calendarioService');
  const calendario = await ejecutarTool('consultar_calendario', { periodo: 'personalizado', desde: '2026-09-17', hasta: '2026-09-20', limite: 25 }, contexto);
  const pantalla = await obtenerEventosCalendario(db, { desde: '2026-09-17', hasta: '2026-09-20', usuario: contexto.usuario });
  assert.equal(calendario.total, pantalla.length);
  assert.ok(calendario.items.some((e) => e.tipo === 'vacuna' && e.animal_id === estrella.id && e.fecha === '2026-09-19'));
  await assert.rejects(ejecutarTool('consultar_calendario', { periodo: 'personalizado', desde: '2026-01-01', hasta: '2026-06-30' }, contexto), (e) => e.code === 'TOOL_ARGUMENTOS_INVALIDOS');
  const vacio = await ejecutarTool('consultar_calendario', { periodo: 'personalizado', desde: '2030-01-01', hasta: '2030-01-02' }, contexto);
  assert.equal(vacio.total, 0);

  // Animal vendido: su historial sigue consultable; no cuenta como pendiente de revisión.
  await db.query(`UPDATE animal SET estado='vendido',fecha_baja='2026-09-15' WHERE id=$1`, [solo.id]);
  assert.equal((await ejecutarTool('consultar_peso', { animal: 'IA-S92' }, contexto)).animal.estado, 'vendido');
  await assert.rejects(ejecutarTool('consultar_peso', { animal: 'P92' }, contexto), (e) => e.code === 'REFERENCIA_AMBIGUA' && e.opcionesEtiquetadas.length === 3);
});

test('P9.2.1 bajas por periodo y trabajadores con SQL real', async () => {
  const contexto = { usuario: { id: 1, rol: 'Administrador' }, db, ahora, telemetria };
  await db.query(`INSERT INTO animal (arete_id,sexo,origen,estado,categoria,fecha_nacimiento,fecha_baja) VALUES
    ('IA-M921A','hembra','nacimiento','muerto','vientre','2021-01-01','2026-09-10'),
    ('IA-M921B','macho','nacimiento','muerto','engorde','2021-01-01','2026-06-15'),
    ('IA-M921C','macho','nacimiento','muerto','engorde','2021-01-01',NULL)`);
  const septiembre = await ejecutarTool('consultar_animales', { estado: 'muerto', periodo: 'mes_actual' }, contexto);
  const directo = (await db.query(`SELECT COUNT(*)::int total FROM animal WHERE estado='muerto' AND fecha_baja BETWEEN '2026-09-01' AND '2026-09-30'`)).rows[0].total;
  assert.equal(septiembre.resumen.total, directo);
  assert.deepEqual(septiembre.rango, { periodo: 'mes_actual', desde: '2026-09-01', hasta: '2026-09-30' });
  const sinFecha = (await db.query(`SELECT COUNT(*)::int total FROM animal WHERE estado='muerto' AND fecha_baja IS NULL`)).rows[0].total;
  assert.equal(septiembre.sin_fecha_baja, sinFecha);
  const tresMeses = await ejecutarTool('consultar_animales', { estado: 'muerto', modo: 'lista', periodo: 'personalizado', desde: '2026-06-17', hasta: '2026-09-17', limite: 25 }, contexto);
  assert.equal(tresMeses.items.some((a) => a.arete_id === 'IA-M921B'), false, 'el 15 de junio queda fuera del rango');
  assert.ok(tresMeses.items.some((a) => a.arete_id === 'IA-M921A' && a.fecha_baja === '2026-09-10'));
  assert.equal(tresMeses.items.some((a) => a.arete_id === 'IA-M921C'), false, 'sin fecha de baja no se ubica en ningún periodo');
  await assert.rejects(ejecutarTool('consultar_animales', { periodo: 'mes_actual' }, contexto), (e) => e.code === 'TOOL_ARGUMENTOS_INVALIDOS');

  const trabajadores = await ejecutarTool('consultar_trabajadores', {}, contexto);
  const conteo = (await db.query('SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE activo)::int activos FROM trabajador')).rows[0];
  assert.equal(trabajadores.resumen.total, conteo.total);
  assert.equal(trabajadores.resumen.activos, conteo.activos);
  assert.ok(trabajadores.items.every((t) => Object.keys(t).sort().join() === 'activo,nombre'), 'sin teléfonos ni identificadores');
  await assert.rejects(ejecutarTool('consultar_trabajadores', {}, { ...contexto, usuario: { id: 2, rol: 'Auditor' } }), (e) => e.code === 'TOOL_SIN_PERMISO');
});

test('P9.3 atención, cruces, corrales y resumen operativo con SQL real', async () => {
  const contexto = { usuario: { id: 1, rol: 'Administrador' }, db, ahora, telemetria };
  const corralX = (await db.query(`INSERT INTO corral (nombre,capacidad_maxima) VALUES ('IA P93 Vientres',50) RETURNING *`)).rows[0];
  const nuevo = async (arete, alias, estadoSalud, sexo = 'hembra', categoria = 'vientre') => (await db.query(`INSERT INTO animal (arete_id,nombre_alias,sexo,origen,estado,categoria,fecha_nacimiento,corral_actual_id,estado_salud,salud_fecha_inicio)
    VALUES ($1,$2,$3,'nacimiento','vivo',$4,'2020-01-01',$5,$6,$7) RETURNING *`, [arete, alias, sexo, categoria, corralX.id, estadoSalud, estadoSalud === 'sano' ? null : '2026-09-05'])).rows[0];
  const julio = await nuevo('IA-P93J', 'Julio P93', 'enfermo', 'macho', 'reproductor');
  const estrella = await nuevo('IA-P93E', 'Estrella P93', 'observacion');
  const tranquila = await nuevo('IA-P93T', 'Tranquila P93', 'sano');
  const usuarioTrabajador = (await db.query(`INSERT INTO usuario (nombre,email,password_hash,rol_id,activo) SELECT 'Trabajador P93','trabajador.p93@rancho.test','x',id,true FROM rol WHERE nombre='Trabajador' RETURNING id`)).rows[0];
  const responsable = (await db.query(`INSERT INTO trabajador (nombre,activo,usuario_id) VALUES ('Responsable P93',true,$1) RETURNING id`, [usuarioTrabajador.id])).rows[0];
  const otro = (await db.query(`INSERT INTO trabajador (nombre,activo) VALUES ('Otro P93',true) RETURNING id`)).rows[0];
  await db.query(`INSERT INTO asignacion_tarea (trabajador_id,titulo,descripcion,fecha,animal_id,estado,tipo,prioridad) VALUES
    ($1,'Revisar cojera P93','Revisar cojera P93','2026-09-12',$2,'pendiente','revision_salud','media'),
    ($3,'Pesar P93','Pesar P93','2026-09-17',$4,'pendiente','pesaje','baja'),
    ($3,'Limpiar bebedero P93','Limpiar bebedero P93','2026-09-01',$5,'pendiente','otra','baja')`, [responsable.id, julio.id, otro.id, estrella.id, tranquila.id]);
  // Tarea de corral sin animal: nunca se atribuye a animales.
  await db.query(`INSERT INTO asignacion_tarea (trabajador_id,titulo,descripcion,fecha,corral_id,estado) VALUES ($1,'Corral P93','Corral P93','2026-09-01',$2,'pendiente')`, [otro.id, corralX.id]);
  await db.query(`INSERT INTO evento_salud (animal_id,tipo,fecha,proxima_dosis) VALUES ($1,'vacuna','2026-05-01','2026-09-10')`, [julio.id]);
  await db.query(`INSERT INTO condicion_corporal (animal_id,fecha,puntuacion) VALUES ($1,'2026-09-15',2)`, [estrella.id]);
  await db.query(`INSERT INTO pesaje (animal_id,fecha,peso_kg) VALUES ($1,'2026-08-01',520),($1,'2026-09-14',505)`, [julio.id]);

  // Atención: un renglón por animal, todos sus motivos, prioridad máxima.
  const consultas = [];
  const dbContado = { query: (...args) => { consultas.push(args[0]); return db.query(...args); } };
  const atencion = await ejecutarTool('consultar_atencion', { limite: 25 }, { ...contexto, db: dbContado });
  const consultasAtencion = consultas.length;
  const deJulio = atencion.items.find((i) => i.id === julio.id);
  assert.equal(deJulio.prioridad, 'alta');
  assert.deepEqual(deJulio.motivos.map((m) => m.tipo).sort(), ['dosis_vencida', 'enfermo', 'tarea_vencida']);
  assert.equal(atencion.items.filter((i) => i.id === julio.id).length, 1, 'deduplicado');
  const deEstrella = atencion.items.find((i) => i.id === estrella.id);
  assert.equal(deEstrella.prioridad, 'media');
  assert.deepEqual(deEstrella.motivos.map((m) => m.tipo).sort(), ['condicion_baja', 'observacion', 'tarea_hoy']);
  assert.equal(atencion.items.find((i) => i.id === tranquila.id).prioridad, 'baja', 'tarea vencida de prioridad baja');
  const rangos = { alta: 1, media: 2, baja: 3 };
  assert.ok(atencion.items.every((item, i, arr) => i === 0 || rangos[arr[i - 1].prioridad] <= rangos[item.prioridad]), 'ordenado por prioridad');
  const directoAnimales = (await db.query(`SELECT COUNT(DISTINCT animal_id)::int total FROM (
      SELECT id animal_id FROM animal WHERE estado='vivo' AND estado_salud IN ('enfermo','observacion')
      UNION ALL SELECT es.animal_id FROM evento_salud es JOIN animal a ON a.id=es.animal_id AND a.estado='vivo' WHERE es.proxima_dosis <= '2026-09-17'::date + 30
      UNION ALL SELECT at.animal_id FROM asignacion_tarea at JOIN animal a ON a.id=at.animal_id AND a.estado='vivo' WHERE at.estado IN ('pendiente','en_progreso') AND at.fecha <= '2026-09-17'
      UNION ALL SELECT u.animal_id FROM (SELECT DISTINCT ON (x.animal_id) x.animal_id,x.puntuacion FROM condicion_corporal x JOIN animal a ON a.id=x.animal_id AND a.estado='vivo' ORDER BY x.animal_id,x.fecha DESC,x.id DESC) u WHERE u.puntuacion <= 2
    ) m`)).rows[0].total;
  assert.ok(atencion.resumen.animales >= directoAnimales, 'incluye además partos próximos de la analítica');
  // Rendimiento: número fijo de consultas, sin una por animal.
  assert.ok(consultasAtencion <= 15, `consultas de atención: ${consultasAtencion}`);

  // Trabajador: solo sus tareas.
  const delTrabajador = await ejecutarTool('consultar_atencion', { limite: 25 }, { ...contexto, usuario: { id: usuarioTrabajador.id, rol: 'Trabajador' } });
  assert.ok(delTrabajador.items.find((i) => i.id === julio.id).motivos.some((m) => m.tipo === 'tarea_vencida'));
  assert.equal(delTrabajador.items.find((i) => i.id === tranquila.id), undefined, 'la tarea de otro trabajador no aparece');

  // Cruces contra SQL directo.
  const enfermosConVencidas = await ejecutarTool('cruzar_animales', { criterios: ['enfermo', 'tarea_vencida'] }, contexto);
  const directo = (await db.query(`SELECT COUNT(*)::int total FROM animal a WHERE a.estado='vivo' AND a.estado_salud='enfermo'
    AND EXISTS (SELECT 1 FROM asignacion_tarea at WHERE at.animal_id=a.id AND at.estado IN ('pendiente','en_progreso') AND at.fecha < '2026-09-17')`)).rows[0].total;
  assert.equal(enfermosConVencidas.total, directo);
  assert.ok(enfermosConVencidas.items.some((i) => i.id === julio.id && i.tareas_vencidas === 1));
  const bajoPeso = await ejecutarTool('cruzar_animales', { criterios: ['bajo_peso', 'enfermo'] }, contexto);
  assert.ok(bajoPeso.items.some((i) => i.id === julio.id && Number(i.peso_reciente) === 505));
  const ccObservacion = await ejecutarTool('cruzar_animales', { criterios: ['condicion_baja', 'observacion'] }, contexto);
  assert.ok(ccObservacion.items.some((i) => i.id === estrella.id && i.condicion_corporal === 2));
  await db.query(`UPDATE animal SET estado_salud='observacion' WHERE id=$1`, [prenada.id]);
  const prenadasObs = await ejecutarTool('cruzar_animales', { criterios: ['prenada', 'observacion'], sexo: 'hembra', etapa: 'adulto' }, contexto);
  assert.ok(prenadasObs.items.some((i) => i.id === prenada.id), 'misma definición de preñada que Reproducción');
  assert.equal(prenadasObs.items.some((i) => i.id === estrella.id), false, 'en observación pero no preñada');

  // Corrales: conteo por corral y tareas solo de animales.
  const porCorral = await ejecutarTool('cruzar_animales', { criterios: ['problema_salud'], agrupar_por: 'corral' }, contexto);
  const directoCorral = (await db.query(`SELECT COALESCE(c.nombre,'Sin corral') corral,COUNT(*)::int total FROM animal a LEFT JOIN corral c ON c.id=a.corral_actual_id
    WHERE a.estado='vivo' AND a.estado_salud IN ('enfermo','observacion') GROUP BY 1`)).rows;
  assert.deepEqual(Object.fromEntries(porCorral.corrales.map((f) => [f.corral, f.animales])), Object.fromEntries(directoCorral.map((f) => [f.corral, f.total])));
  const tareasCorral = await ejecutarTool('cruzar_animales', { criterios: ['tarea_vencida'], agrupar_por: 'corral', ordenar_por: 'tareas' }, contexto);
  const filaX = tareasCorral.corrales.find((f) => f.corral_id === corralX.id);
  assert.equal(filaX.tareas_vencidas, 2, 'Julio y Tranquila; la tarea del corral no se atribuye');

  // Resumen operativo contra SQL directo.
  const resumen = await ejecutarTool('consultar_resumen_operativo', {}, contexto);
  const vivos = (await db.query(`SELECT COUNT(*)::int vivos,COUNT(*) FILTER (WHERE estado_salud='enfermo')::int enfermos,COUNT(*) FILTER (WHERE estado_salud='observacion')::int obs FROM animal WHERE estado='vivo'`)).rows[0];
  assert.deepEqual([resumen.secciones.animales.vivos, resumen.secciones.animales.enfermos, resumen.secciones.animales.en_observacion], [vivos.vivos, vivos.enfermos, vivos.obs]);
  const tareas = (await db.query(`SELECT COUNT(*) FILTER (WHERE fecha < '2026-09-17')::int vencidas,COUNT(*) FILTER (WHERE fecha = '2026-09-17')::int hoy FROM asignacion_tarea WHERE estado IN ('pendiente','en_progreso')`)).rows[0];
  assert.deepEqual([resumen.secciones.tareas.vencidas, resumen.secciones.tareas.hoy], [tareas.vencidas, tareas.hoy]);
  assert.equal('finanzas' in resumen.secciones, false);
  // La preñada se marcó en observación más arriba: se compara con la atención actual.
  assert.equal(resumen.secciones.atencion.animales, (await ejecutarTool('consultar_atencion', { limite: 1 }, contexto)).resumen.animales);
});
