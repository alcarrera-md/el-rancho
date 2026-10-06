import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calcularPanoramaEconomico, filtrarRentabilidadAnimales, margenAnimal } from '../src/rentabilidadUx.js';
import { estadoStock, estaCaducado, filtrarOrdenarInsumos, nivelStock, resumirInsumos } from '../src/insumosUx.js';
import { tienePermiso } from '../src/authorization/permissions.js';

const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');

test('el panorama económico explica ingresos, costos, resultado y margen sin inventar una base', () => {
  const panorama = calcularPanoramaEconomico({
    ingresos: { ventas: 800, leche: 200, total: 1000 },
    gastos: { insumos: 250, animales: 100, generales: 150, total: 500 },
    utilidad_neta: 500,
  });

  assert.deepEqual([panorama.ingresos, panorama.costos, panorama.resultado, panorama.margen], [1000, 500, 500, 50]);
  assert.equal(panorama.mayorCosto.etiqueta, 'Compras de insumos');
  assert.equal(calcularPanoramaEconomico({ ingresos: {}, gastos: {}, utilidad_neta: -10 }).margen, null);
});

test('la rentabilidad animal filtra por estado, arete o alias y evita margen sin ingreso', () => {
  const animales = [
    { id: 1, arete_id: 'MX-101', nombre_alias: 'Luna', estado: 'vivo', ingreso_total: 1000, neto: 250 },
    { id: 2, arete_id: 'MX-202', nombre_alias: 'Sol', estado: 'vendido', ingreso_total: 0, neto: -90 },
  ];

  assert.deepEqual(filtrarRentabilidadAnimales(animales, { estado: 'vivo', consulta: 'luna' }).map((a) => a.id), [1]);
  assert.deepEqual(filtrarRentabilidadAnimales(animales, { consulta: '202' }).map((a) => a.id), [2]);
  assert.equal(margenAnimal(animales[0]), 25);
  assert.equal(margenAnimal(animales[1]), null);
});

test('el inventario distingue suficiente, bajo y agotado y resume categorías', () => {
  const insumos = [
    { id: 1, nombre: 'Heno', tipo: 'alimento', stock_actual: 20, stock_minimo: 10 },
    { id: 2, nombre: 'Vacuna A', tipo: 'vacuna', stock_actual: 5, stock_minimo: 5 },
    { id: 3, nombre: 'Sales', tipo: 'alimento', stock_actual: 0, stock_minimo: 4 },
  ];

  assert.deepEqual(insumos.map(estadoStock), ['bien', 'bajo', 'agotado']);
  assert.deepEqual(resumirInsumos(insumos), { total: 3, bien: 1, bajo: 1, agotado: 1, categorias: 2 });
  assert.deepEqual(nivelStock(insumos[1]), { porcentaje: 50, minimo: 50 });
});

test('los insumos que requieren acción aparecen primero e incluyen caducados', () => {
  const hoy = new Date('2026-08-29T12:00:00Z');
  const insumos = [
    { id: 1, nombre: 'Suficiente', tipo: 'otro', stock_actual: 10, stock_minimo: 2 },
    { id: 2, nombre: 'Agotado', tipo: 'otro', stock_actual: 0, stock_minimo: 2 },
    { id: 3, nombre: 'Caducado', tipo: 'vacuna', stock_actual: 10, stock_minimo: 2, fecha_caducidad: '2026-08-20T00:00:00Z' },
  ];

  assert.equal(estaCaducado(insumos[2], hoy), true);
  assert.deepEqual(filtrarOrdenarInsumos(insumos, { soloAtencion: true, hoy }).map((i) => i.id), [2, 3]);
});

test('Rentabilidad usa datos reales existentes y explica los dos alcances', () => {
  const componente = leer('src/components/RentabilidadReporte.jsx');
  assert.match(componente, /api\.reporteFinanciero\(params\)/);
  assert.match(componente, /api\.reporteRentabilidad\(\)/);
  assert.match(componente, /No incluye gastos generales/);
  assert.match(componente, /Por cada \$100 ingresados/);
  assert.doesNotMatch(componente, /<table/);
});

test('Insumos conserva filtros, prioriza atención y reutiliza la compra existente por rol', () => {
  const componente = leer('src/components/InsumosList.jsx');
  assert.match(componente, /useSearchParams/);
  assert.match(componente, /crearRutaContextual\('\/compras', \{ vista: 'insumos', insumo: insumo\.id, accion: 'comprar' \}\)/);
  assert.match(componente, /puedeComprar &&/);
  assert.match(componente, /puedeGestionar &&/);
  assert.match(componente, /Ver consumo/);
  assert.match(componente, /Ver compras/);
  assert.doesNotMatch(componente, /<table/);
});

test('Administrador, Trabajador, Veterinario y Auditor conservan la lectura; solo Administrador compra o edita', () => {
  const roles = ['Administrador', 'Trabajador', 'Veterinario', 'Auditor'];
  for (const rol of roles) {
    assert.equal(tienePermiso(rol, 'insumos', 'leer'), true, `${rol} debe leer insumos`);
    assert.equal(tienePermiso(rol, 'reportes', 'leer'), true, `${rol} debe leer rentabilidad`);
    assert.equal(tienePermiso(rol, 'gastos_generales', 'leer'), true, `${rol} debe leer gastos`);
  }
  for (const rol of roles.slice(1)) {
    assert.equal(tienePermiso(rol, 'compras_insumo', 'crear'), false, `${rol} no debe registrar compras`);
    assert.equal(tienePermiso(rol, 'insumos', 'editar'), false, `${rol} no debe editar insumos`);
  }
  assert.equal(tienePermiso('Administrador', 'compras_insumo', 'crear'), true);
  assert.equal(tienePermiso('Administrador', 'insumos', 'editar'), true);
});

test('las nuevas vistas cambian a una columna sin anchos mínimos que provoquen desborde', () => {
  const css = leer('src/styles.css');
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*economic-kpi-grid[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.economic-page, \.inventory-page \{ min-width: 0; \}/);
  assert.match(css, /\.inventory-card-grid \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
});
