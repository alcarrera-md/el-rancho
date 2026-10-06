import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  estadoOperativoCorral, exigirListaModulo, filtrarSeguimiento, ordenarCorrales, resumirCorrales, resumirSeguimiento,
} from '../src/monitoringUx.js';
import { normalizarExpedienteAnimal } from '../src/seguimientoData.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const leer = (ruta) => fs.readFileSync(path.join(DIR, '..', ruta), 'utf8');

const animales = [
  { id: 1, arete_id: 'MX-001', nombre_alias: 'Luna', corral_actual: 'Norte', estado_salud: 'sano', ultimo_peso_kg: 410 },
  { id: 2, arete_id: 'MX-002', nombre_alias: 'Sol', corral_actual: 'Maternidad', estado_salud: 'enfermo', ultimo_peso_kg: null },
  { id: 3, arete_id: 'MX-003', nombre_alias: 'Brisa', corral_actual: null, estado_salud: 'observacion', ultimo_peso_kg: 360 },
];

test('Seguimiento resume, prioriza y busca sin perder contexto ganadero', () => {
  assert.deepEqual(resumirSeguimiento(animales), { total: 3, alerta: 1, observacion: 1, estable: 1, sinCorral: 1, sinPesaje: 1 });
  assert.deepEqual(filtrarSeguimiento(animales).map((animal) => animal.id), [2, 3, 1]);
  assert.deepEqual(filtrarSeguimiento(animales, { consulta: 'mater', vista: 'alerta' }).map((animal) => animal.id), [2]);
});

test('Corrales distingue salud, capacidad y observación con prioridad estable', () => {
  const corrales = [
    { id: 1, ocupacion_actual: 6, capacidad_maxima: 10, enfermos: 0, en_observacion: 0 },
    { id: 2, ocupacion_actual: 10, capacidad_maxima: 10, enfermos: 0, en_observacion: 0 },
    { id: 3, ocupacion_actual: 3, capacidad_maxima: 8, enfermos: 1, en_observacion: 2 },
  ];
  assert.equal(estadoOperativoCorral(corrales[0], 90).id, 'normal');
  assert.equal(estadoOperativoCorral(corrales[1], 90).id, 'lleno');
  assert.equal(estadoOperativoCorral(corrales[2], 90).id, 'alerta');
  assert.deepEqual(ordenarCorrales(corrales, 90).map((corral) => corral.id), [3, 2, 1]);
  assert.deepEqual(resumirCorrales(corrales, 90), { corrales: 3, animales: 19, capacidad: 28, alertas: 2, observacion: 2 });
});

test('Seguimiento y Corrales rechazan una colección inesperada indicando el endpoint exacto', () => {
  assert.deepEqual(exigirListaModulo(animales, '/api/animales'), animales);
  assert.throws(() => exigirListaModulo({}, '/api/corrales'), (error) => {
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.equal(error.ruta, '/api/corrales');
    assert.match(error.message, /se esperaba una lista/);
    return true;
  });
  const seguimiento = leer('src/components/SeguimientoList.jsx');
  const corrales = leer('src/components/CorralesList.jsx');
  assert.match(seguimiento, /exigirListaModulo\(data, '\/api\/animales\?estado=vivo'\)/);
  assert.match(corrales, /exigirListaModulo\(data, '\/api\/corrales'\)/);
});

test('las pantallas ofrecen acciones reales, detalle y medidores accesibles sin volver a tablas', () => {
  const seguimiento = leer('src/components/SeguimientoList.jsx');
  const corrales = leer('src/components/CorralesList.jsx');
  const app = leer('src/App.jsx');
  const css = leer('src/styles.css');

  assert.match(seguimiento, /AccionesRapidasAnimal/);
  assert.match(seguimiento, /Ver expediente/);
  assert.doesNotMatch(seguimiento, /<table/);
  assert.match(corrales, /Ver animales/);
  assert.match(corrales, /role="progressbar"/);
  assert.match(corrales, /api\.listarAnimales\(\{ estado: 'vivo', corral_id: corral\.id \}\)/);
  assert.match(corrales, /crearRutaContextual\('\/movimientos', \{ corral: corral\.id \}\)/);
  assert.match(css, /@media \(max-width: 359px\)[\s\S]*\.monitoring-summary-grid/);
});

test('el expediente individual acepta datos normales y colecciones históricas nulas', () => {
  const normal = normalizarExpedienteAnimal({
    animal: { id: 11, arete_id: '23245' },
    resumen: { total_pesajes: 1 },
    recomendaciones: [], timeline: [{ tipo: 'salud', detalle: { tipo: 'vacuna' } }], crias: [], notas: [], plan_sanitario: [],
  });
  assert.equal(normal.animal.id, 11);
  assert.equal(normal.timeline[0].detalle.tipo, 'vacuna');

  const historico = normalizarExpedienteAnimal({
    animal: { id: 12, arete_id: 'HIST-12' },
    resumen: null, recomendaciones: null, timeline: [{ tipo: 'salud', detalle: null }], crias: null, notas: null, plan_sanitario: null,
  });
  assert.deepEqual(historico.recomendaciones, []);
  assert.deepEqual(historico.crias, []);
  assert.deepEqual(historico.notas, []);
  assert.deepEqual(historico.plan_sanitario, []);
  assert.deepEqual(historico.timeline[0].detalle, {});
  assert.equal(historico.resumen.total_pesajes, 0);
});

test('el expediente rechaza contratos inválidos con el endpoint de historial', () => {
  assert.throws(() => normalizarExpedienteAnimal({ animal: { id: 1 }, timeline: {} }), (error) => {
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.equal(error.ruta, '/api/animales/:id/historial');
    return true;
  });
});

test('Movimientos diferencia datos, vacío, carga y error sin ocultar endpoints', () => {
  const movimientos = leer('src/components/Movimientos.jsx');
  assert.match(movimientos, /exigirListaModulo\(data, '\/api\/corrales\/movimientos'\)/);
  assert.match(movimientos, /errorMovimientos && <EstadoError/);
  assert.match(movimientos, /movimientos\?\.length === 0/);
  assert.match(movimientos, /<EstadoCarga mensaje="Cargando movimientos…"/);
});

test('Reproducción identifica cada endpoint cuando una carga es parcial', () => {
  const reproduccion = leer('src/components/Reproduccion.jsx');
  const api = leer('src/api.js');
  assert.match(api, /\/reproduccion\/hato-operable/);
  assert.match(reproduccion, /obtenerHatoReproductivoOperable/);
  assert.match(reproduccion, /<EstadoError mensaje=\{errorCarga\} onReintentar=\{cargar\}/);
});

test('Inicio solicita una ventana operativa de partos y reserva tres años para análisis histórico', () => {
  const dashboard = leer('src/components/Dashboard.jsx');
  const api = leer('src/api.js');
  assert.match(dashboard, /const DIAS_PARTO_PROXIMO = 30/);
  assert.match(dashboard, /api\.partosProximos\(DIAS_PARTO_PROXIMO\)/);
  assert.match(dashboard, /partos-proximos\?dias=\$\{DIAS_PARTO_PROXIMO\}/);
  assert.doesNotMatch(dashboard, /1095|DIAS_GESTACION_VENTANA/);
  assert.match(api, /exportarReproduccion:[\s\S]*reproduccion\/exportacion/);
});

test('la bitácora controla sus acordeones sin enviar defaultOpen al DOM', () => {
  const bitacora = leer('src/components/BitacoraList.jsx');
  assert.doesNotMatch(bitacora, /defaultOpen/);
  assert.match(bitacora, /onToggle=\{\(evento\) =>/);
});

test('Finanzas no impone una columna de 340 px en pantallas angostas', () => {
  const finanzas = leer('src/components/Finanzas.jsx');
  const css = leer('src/styles.css');
  assert.match(finanzas, /className="finance-charts-grid"/);
  assert.match(css, /\.finance-charts-grid \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
});

test('las tarjetas compactas limitan acciones visibles y usan iconos React con fallback local', () => {
  const acciones = leer('src/components/AccionesRapidasAnimal.jsx');
  const imagen = leer('src/components/ImagenAnimal.jsx');
  const css = leer('src/styles.css');
  assert.match(acciones, /acciones\.slice\(0, 2\)/);
  assert.match(acciones, /<IconoLista[^>]+aria-hidden="true"/);
  assert.doesNotMatch(acciones, /<img/);
  assert.match(imagen, /onError=\{\(\) => setFallo\(true\)\}/);
  assert.match(css, /\.field-action svg \{ flex: 0 0 18px; \}/);
  assert.match(css, /\.field-actions-compactas \{ grid-template-columns: repeat\(2/);
});
