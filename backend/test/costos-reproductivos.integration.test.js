const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');

cargarEntornoPruebas();
const db = require('../src/db');
const app = require('../src/app');

const tokens = {};
let secuencia = 0;
const marca = (prefijo) => `P6-${prefijo}-${Date.now()}-${++secuencia}`;

async function usuario(rol) {
  const { rows } = await db.query(`INSERT INTO usuario(nombre,email,password_hash,rol_id,activo)
    SELECT $1,$2,'hash',id,true FROM rol WHERE nombre=$3 RETURNING id,nombre,email`,
  [marca(rol), `${marca(rol).toLowerCase()}@test.local`, rol]);
  tokens[rol] = jwt.sign({ ...rows[0], rol, sesion_version: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
function api(rol, metodo, ruta, body) {
  const llamada = request(app)[metodo](ruta).set('Authorization', `Bearer ${tokens[rol]}`);
  return body === undefined ? llamada : llamada.send(body);
}
async function animal(sexo) {
  return (await db.query(`INSERT INTO animal(arete_id,sexo,origen,estado,categoria,fecha_nacimiento)
    VALUES($1,$2,'nacimiento','vivo',$3,'2020-01-01') RETURNING *`, [marca(sexo), sexo, sexo === 'hembra' ? 'vientre' : 'reproductor'])).rows[0];
}

test.before(async () => {
  for (const rol of ['Administrador', 'Veterinario', 'Trabajador', 'Auditor']) await usuario(rol);
});
test.after(async () => db.pool.end());

test('P6 calcula importes exactos por preñez, parto, pérdida y periodo sin inventar costos', async () => {
  const vaca = await animal('hembra'); const toro = await animal('macho');
  const alta = await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: vaca.id, macho_id: toro.id, tipo: 'natural', fecha: '2026-01-10' });
  assert.equal(alta.status, 201);
  const ciclo = alta.body.ciclo.id; const servicio = alta.body.servicio.id;
  const costoServicio = await api('Administrador', 'post', '/api/costos-reproductivos', {
    fecha: '2026-01-10', categoria: 'monta_servicio', monto: '100.25', procedencia: 'captura_manual', servicio_id: servicio,
  });
  assert.equal(costoServicio.status, 201);
  assert.equal(costoServicio.body.ciclo_id, ciclo);
  assert.equal(costoServicio.body.animal_id, vaca.id);
  assert.equal(costoServicio.body.toro_id, toro.id);

  const diagnostico = await api('Administrador', 'post', `/api/reproduccion/ciclos/${ciclo}/diagnosticos`, { fecha: '2026-02-20', metodo: 'palpacion', resultado: 'prenada', servicio_id: servicio });
  await api('Administrador', 'post', '/api/costos-reproductivos', { fecha: '2026-02-20', categoria: 'palpacion', monto: '50.50', procedencia: 'captura_manual', diagnostico_id: diagnostico.body.id });
  const parto = await api('Administrador', 'post', `/api/reproduccion/ciclos/${ciclo}/partos`, { fecha_real: '2026-08-20', resultado: 'parto', crias: [] });
  await api('Administrador', 'post', '/api/costos-reproductivos', { fecha: '2026-08-20', categoria: 'veterinario', monto: '200.25', procedencia: 'captura_manual', parto_id: parto.body.parto.id });

  const sinCostos = await animal('hembra');
  await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: sinCostos.id, tipo: 'natural', fecha: '2026-03-01' });

  const perdida = await animal('hembra');
  const altaPerdida = await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: perdida.id, tipo: 'natural', fecha: '2026-01-15' });
  await api('Administrador', 'post', '/api/costos-reproductivos', { fecha: '2026-01-15', categoria: 'monta_servicio', monto: '75.00', procedencia: 'captura_manual', servicio_id: altaPerdida.body.servicio.id });
  await api('Administrador', 'post', `/api/reproduccion/ciclos/${altaPerdida.body.ciclo.id}/diagnosticos`, { fecha: '2026-02-25', metodo: 'palpacion', resultado: 'prenada' });
  await api('Administrador', 'post', `/api/reproduccion/ciclos/${altaPerdida.body.ciclo.id}/partos`, { fecha_real: '2026-05-01', resultado: 'aborto', crias: [] });

  const resumen = await api('Auditor', 'get', '/api/costos-reproductivos/analitica/resumen?periodo=personalizado&desde=2026-01-01&hasta=2026-12-31');
  assert.equal(resumen.status, 200);
  assert.equal(resumen.body.total, '426.00');
  assert.equal(resumen.body.costo_por_servicio.valor, '87.63');
  assert.equal(resumen.body.costo_por_servicio.numerador, '175.25');
  assert.equal(resumen.body.costo_por_servicio.denominador, 2);
  assert.ok(resumen.body.costo_por_servicio.total_eventos >= 3);
  assert.equal(resumen.body.costo_por_diagnostico.valor, '50.50');
  assert.equal(resumen.body.costo_por_diagnostico.denominador, 1);
  assert.ok(resumen.body.costo_por_diagnostico.total_eventos >= 2);
  assert.deepEqual({ valor: resumen.body.costo_por_prenez.valor, numerador: resumen.body.costo_por_prenez.numerador, denominador: resumen.body.costo_por_prenez.denominador, estado: resumen.body.costo_por_prenez.estado }, { valor: '213.00', numerador: '426.00', denominador: 2, estado: 'calculado' });
  assert.equal(resumen.body.costo_por_parto.valor, '351.00');
  assert.equal(resumen.body.costo_por_parto.denominador, 1);
  assert.deepEqual(resumen.body.perdidas, { ciclos: 1, costo_acumulado: '75.00' });
  const cicloExitoso = resumen.body.por_ciclo.find((item) => item.ciclo_id === ciclo);
  assert.deepEqual({ total: cicloExitoso.total, servicios: cicloExitoso.servicios, diagnosticos: cicloExitoso.diagnosticos, parto: cicloExitoso.parto }, { total: '351.00', servicios: '100.25', diagnosticos: '50.50', parto: '200.25' });

  const perfil = await api('Auditor', 'get', `/api/costos-reproductivos/sementales/${toro.id}?periodo=personalizado&desde=2026-01-01&hasta=2026-12-31`);
  assert.equal(perfil.status, 200);
  assert.equal(perfil.body.costo_atribuible, '351.00');
  assert.equal(perfil.body.costo_por_concepcion, '351.00');
  assert.equal(perfil.body.costo_por_parto, '351.00');
  assert.deepEqual(perfil.body.completitud, { atribuibles: 1, muestra: 1 });
});

test('fuentes existentes no se contabilizan dos veces y relaciones duplicadas se rechazan', async () => {
  const vaca = await animal('hembra');
  const alta = await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: vaca.id, tipo: 'natural', fecha: '2026-04-01' });
  const categoria = (await db.query(`SELECT id FROM categoria_gasto WHERE nombre='Veterinario'`)).rows[0];
  const gasto = (await db.query(`INSERT INTO gasto_general(categoria_id,fecha,monto,descripcion) VALUES($1,'2026-04-01',80,'P6') RETURNING *`, [categoria.id])).rows[0];
  const costo = { fecha: '2026-04-01', categoria: 'veterinario', monto: '80.00', procedencia: 'gasto_general_relacionado', gasto_general_id: gasto.id, ciclo_id: alta.body.ciclo.id };
  assert.equal((await api('Administrador', 'post', '/api/costos-reproductivos', costo)).status, 201);
  assert.equal((await api('Administrador', 'post', '/api/costos-reproductivos', costo)).status, 409);
  const tercero = (await db.query(`INSERT INTO tercero(nombre,tipo) VALUES($1,'proveedor') RETURNING id`, [marca('proveedor')])).rows[0];
  const insumo = (await db.query(`INSERT INTO insumo(nombre,tipo,unidad_medida,stock_actual) VALUES($1,'medicamento','dosis',10) RETURNING id`, [marca('insumo')])).rows[0];
  const compra = (await db.query(`INSERT INTO compra_insumo(insumo_id,tercero_id,fecha,cantidad,costo_total) VALUES($1,$2,'2026-04-01',10,120) RETURNING id`, [insumo.id, tercero.id])).rows[0];
  const costoInsumo = await api('Administrador', 'post', '/api/costos-reproductivos', { fecha: '2026-04-01', categoria: 'medicamento_insumo', monto: '60.00', procedencia: 'compra_insumo_relacionada', compra_insumo_id: compra.id, ciclo_id: alta.body.ciclo.id });
  assert.equal(costoInsumo.status, 201);
  assert.equal(costoInsumo.body.insumo_id, insumo.id);
  const finanzas = await api('Administrador', 'get', '/api/reportes/financiero?desde=2026-04-01&hasta=2026-04-01');
  assert.equal(finanzas.body.gastos.generales, 80);
  assert.equal(finanzas.body.gastos.insumos, 120);
  assert.equal(finanzas.body.gastos.reproductivos, 0);
  assert.equal(finanzas.body.gastos.total, 200);
});

test('permisos, auditoría, edición, eliminación y rollback protegen los costos', async () => {
  const vaca = await animal('hembra'); const otra = await animal('hembra');
  const alta = await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: vaca.id, tipo: 'natural', fecha: '2026-06-01' });
  assert.equal((await api('Veterinario', 'get', '/api/costos-reproductivos')).status, 403);
  assert.equal((await api('Trabajador', 'post', '/api/costos-reproductivos', { fecha: '2026-06-01', categoria: 'otro', monto: '10', ciclo_id: alta.body.ciclo.id })).status, 403);
  assert.equal((await api('Administrador', 'post', '/api/costos-reproductivos', { fecha: '2026-06-01', categoria: 'otro', monto: '0', procedencia: 'captura_manual', ciclo_id: alta.body.ciclo.id })).status, 400);
  const creado = await api('Administrador', 'post', '/api/costos-reproductivos', { fecha: '2026-06-01', categoria: 'procedimiento', monto: '33.33', procedencia: 'captura_manual', ciclo_id: alta.body.ciclo.id });
  const ambiguo = await api('Administrador', 'post', '/api/costos-reproductivos', { fecha: '2026-06-01', categoria: 'otro', monto: '10.00', procedencia: 'captura_manual', ciclo_id: alta.body.ciclo.id, servicio_id: alta.body.servicio.id, diagnostico_id: 2147483000 });
  assert.equal(ambiguo.status, 409);
  const fallo = await api('Administrador', 'patch', `/api/costos-reproductivos/${creado.body.id}`, { animal_id: otra.id });
  assert.equal(fallo.status, 409);
  const intacto = await api('Auditor', 'get', `/api/costos-reproductivos?ciclo_id=${alta.body.ciclo.id}`);
  assert.equal(intacto.body[0].monto, '33.33');
  assert.equal((await api('Administrador', 'patch', `/api/costos-reproductivos/${creado.body.id}`, { monto: '40.00' })).status, 200);
  assert.equal((await api('Administrador', 'delete', `/api/costos-reproductivos/${creado.body.id}`)).status, 204);
  const auditoria = await db.query(`SELECT accion,detalle FROM bitacora WHERE entidad='costo_reproductivo' AND entidad_id=$1 ORDER BY id`, [creado.body.id]);
  assert.deepEqual(auditoria.rows.map((r) => r.accion), ['registrar_costo_reproductivo', 'editar_costo_reproductivo', 'eliminar_costo_reproductivo']);
  assert.equal(auditoria.rows[1].detalle.antes.monto, '33.33');
  assert.equal(auditoria.rows[1].detalle.despues.monto, '40.00');
});

test('captura opcional de campo es atómica y no permite saltarse el permiso financiero', async () => {
  const vaca = await animal('hembra');
  const payload = { hembra_id: vaca.id, tipo: 'natural', fecha: '2026-07-01', costo: { categoria: 'monta_servicio', monto: '125.00', descripcion: 'Servicio directo' } };
  const rechazado = await api('Veterinario', 'post', '/api/reproduccion/servicios', payload);
  assert.equal(rechazado.status, 403);
  assert.equal(Number((await db.query('SELECT COUNT(*) total FROM ciclo_reproductivo WHERE hembra_id=$1', [vaca.id])).rows[0].total), 0);
  const creado = await api('Administrador', 'post', '/api/reproduccion/servicios', payload);
  assert.equal(creado.status, 201);
  assert.equal(creado.body.costo.monto, '125.00');
  assert.equal(creado.body.costo.servicio_id, creado.body.servicio.id);
  const hechos = await db.query(`SELECT
    (SELECT COUNT(*)::int FROM servicio_reproductivo WHERE id=$1) servicios,
    (SELECT COUNT(*)::int FROM costo_reproductivo WHERE servicio_id=$1) costos,
    (SELECT COUNT(*)::int FROM bitacora WHERE entidad='costo_reproductivo' AND entidad_id=$2) auditorias`, [creado.body.servicio.id, creado.body.costo.id]);
  assert.deepEqual(hechos.rows[0], { servicios: 1, costos: 1, auditorias: 1 });
});
