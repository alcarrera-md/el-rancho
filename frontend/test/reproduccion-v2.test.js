import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  accionParaEstado, construirAtencionReproductiva, construirEstadoHato, construirHatoOperable,
  coincideFiltroReproductivo, esAnimalReproductivoOperable, etiquetaCiclo, metricasEstadoHato,
} from '../src/reproduccionUx.js';
import { normalizarFilasReproductivas, sugerirMapeoReproductivo } from '../src/reproduccionImport.js';

const leer = (ruta) => fs.readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');

function ciclo(id, hembraId, codigo, extras = {}) {
  return {
    id, hembra_id: hembraId, fecha_inicio: extras.fecha_inicio || '2026-01-12', fecha_cierre: extras.fecha_cierre || null,
    estado_actual: { codigo, etiqueta: codigo, ...extras.estado_actual },
    servicios: extras.servicios || [{ id: id * 10, fecha: '2026-01-12', macho_id: 51, macho_arete: '51', tipo: 'natural' }],
    diagnosticos: extras.diagnosticos || [], parto: extras.parto || null, crias: extras.crias || [],
  };
}

test('cada estado ofrece una sola acción principal comprensible', () => {
  assert.deepEqual(accionParaEstado('disponible'), { id: 'servicio', etiqueta: 'Registrar servicio' });
  assert.equal(accionParaEstado('servida').id, 'diagnostico');
  assert.equal(accionParaEstado('pendiente_diagnostico').etiqueta, 'Registrar diagnóstico');
  assert.equal(accionParaEstado('requiere_revision').etiqueta, 'Registrar revisión');
  assert.equal(accionParaEstado('prenada').id, 'parto');
  assert.equal(accionParaEstado('proxima_parto').id, 'parto');
  assert.equal(accionParaEstado('vacia').etiqueta, 'Registrar servicio');
  assert.equal(accionParaEstado('parida').id, 'seguimiento');
});

test('las cifras del hato contienen exactamente los animales de cada estado visual', () => {
  const animales = [1, 2, 3, 4, 5, 6].map((id) => ({ id, arete_id: String(200 + id), nombre_alias: `Vaca ${id}`, corral_actual: id < 4 ? 'Norte' : 'Sur' }));
  const filas = construirEstadoHato(animales, [
    ciclo(1, 1, 'prenada'), ciclo(2, 2, 'proxima_parto'), ciclo(3, 3, 'servida'),
    ciclo(4, 4, 'requiere_revision'), ciclo(5, 5, 'vacia', { fecha_cierre: '2026-08-01' }),
  ]);
  const metricas = metricasEstadoHato(filas);
  assert.deepEqual(metricas.prenada.map((fila) => fila.animal.id), [1, 2]);
  assert.deepEqual(metricas.pendiente_diagnostico.map((fila) => fila.animal.id), [3]);
  assert.deepEqual(metricas.requiere_revision.map((fila) => fila.animal.id), [4]);
  assert.deepEqual(metricas.proxima_parto.map((fila) => fila.animal.id), [2]);
  assert.deepEqual(metricas.vacia.map((fila) => fila.animal.id), [5]);
  assert.equal(filas.find((fila) => fila.animal.id === 6).codigo, 'disponible');
});

test('muertos, vendidos, sacrificados y categorías no operables quedan fuera del trabajo activo', () => {
  const base = { sexo: 'hembra', categoria: 'vientre' };
  const registros = [
    { animal: { ...base, id: 1, estado: 'vivo' }, ciclo: ciclo(1, 1, 'servida') },
    { animal: { ...base, id: 2, estado: 'vendido' }, ciclo: ciclo(2, 2, 'prenada') },
    { animal: { ...base, id: 3, estado: 'muerto' }, ciclo: ciclo(3, 3, 'prenada') },
    { animal: { ...base, id: 4, estado: 'sacrificado' }, ciclo: ciclo(4, 4, 'proxima_parto') },
    { animal: { ...base, id: 5, estado: 'vivo', categoria: 'descarte' }, ciclo: ciclo(5, 5, 'servida') },
  ];
  assert.equal(esAnimalReproductivoOperable(registros[0].animal), true);
  assert.deepEqual(construirHatoOperable(registros).map((fila) => fila.animal.id), [1]);
});

test('la bandeja prioriza vencidos, revisión, parto, pérdida y vacías', () => {
  const animales = [1, 2, 3, 4].map((id) => ({ id, arete_id: String(id), corral_actual: 'Norte' }));
  const filas = construirEstadoHato(animales, [
    ciclo(1, 1, 'pendiente_diagnostico', { estado_actual: { fecha_diagnostico_sugerida: '2026-09-01' } }),
    ciclo(2, 2, 'requiere_revision', { diagnosticos: [{ fecha: '2026-08-20', resultado: 'dudoso', fecha_siguiente_revision: '2026-09-10' }] }),
    ciclo(3, 3, 'proxima_parto', { estado_actual: { fecha_parto_estimada: '2026-09-30' } }),
    ciclo(4, 4, 'perdida_aborto', { fecha_cierre: '2026-09-12' }),
  ]);
  const atencion = construirAtencionReproductiva(filas, '2026-09-16');
  assert.equal(atencion[0].motivo, 'Diagnóstico vencido');
  assert.ok(atencion.some((item) => item.motivo === 'Revisión vencida'));
  assert.ok(atencion.some((item) => item.motivo === 'Parto próximo'));
  assert.ok(atencion.some((item) => item.motivo === 'Seguimiento después de pérdida'));
});

test('los filtros combinan estado, corral, periodo, toro y próxima acción', () => {
  const [fila] = construirEstadoHato([{ id: 1, arete_id: '248', corral_actual: 'Norte' }], [ciclo(1, 1, 'servida')]);
  const filtros = { estado: 'servida', corral: 'Norte', periodo: 'anio', toro: '51', accion: 'diagnostico' };
  assert.equal(coincideFiltroReproductivo(fila, filtros, new Date('2026-09-16T12:00:00')), true);
  assert.equal(coincideFiltroReproductivo(fila, { ...filtros, corral: 'Sur' }, new Date('2026-09-16T12:00:00')), false);
  assert.equal(coincideFiltroReproductivo(fila, { ...filtros, toro: '99' }, new Date('2026-09-16T12:00:00')), false);
  assert.equal(etiquetaCiclo({ fecha_inicio: '2025-04-01', fecha_cierre: '2026-02-01' }), 'Ciclo 2025–2026');
});

test('timeline por ciclo conserva el actual abierto y ciclos previos colapsables', async () => {
  const [seguimiento, timeline] = await Promise.all([
    leer('src/components/SeguimientoAnimal.jsx'), leer('src/components/TimelineReproductiva.jsx'),
  ]);
  assert.match(seguimiento, /Historia reproductiva por ciclo/);
  assert.match(seguimiento, /accionParaEstado/);
  assert.match(timeline, /repro-timeline-cycle is-current/);
  assert.match(timeline, /<details className="repro-timeline-cycle"/);
  assert.match(timeline, /<summary>/);
  assert.match(timeline, /cría\(s\)/);
  assert.match(timeline, /Parto estimado/);
  assert.match(timeline, /repro-timeline-icon/);
  assert.match(timeline, /Registros anteriores/);
});

test('formularios priorizan palpación y separan parto, pérdida y aborto', async () => {
  const [diagnostico, parto, servicio] = await Promise.all([
    leer('src/components/RegistrarDiagnosticoGestacionModal.jsx'),
    leer('src/components/RegistrarPartoModal.jsx'),
    leer('src/components/RegistrarMontaModal.jsx'),
  ]);
  assert.match(diagnostico, /\['prenada', 'Preñada'\]/);
  assert.match(diagnostico, /Palpación/);
  assert.match(diagnostico, /Ultrasonido/);
  assert.match(diagnostico, /Responsable, observaciones y revisión/);
  assert.match(parto, /\['parto', 'Parto'\]/);
  assert.match(parto, /\['perdida', 'Pérdida'\]/);
  assert.match(parto, /\['aborto', 'Aborto'\]/);
  assert.match(parto, /Fecha del \{etiquetaResultado\}/);
  assert.doesNotMatch(parto, /<label>Fecha del parto<\/label>/);
  assert.match(servicio, /Calculada automáticamente/);
  assert.match(servicio, /Fecha ajustada manualmente/);
  assert.match(servicio, /dias_gestacion_bovina/);
  assert.match(servicio, /animal\.estado === 'vivo' && animal\.sexo === 'macho'/);
  assert.match(parto, /a\.estado === 'vivo'/);
});

test('un cambio concurrente muestra mensaje amigable y regresa al listado reproductivo', async () => {
  const [seguimiento, servicio, diagnostico, parto] = await Promise.all([
    leer('src/components/SeguimientoAnimal.jsx'), leer('src/components/RegistrarMontaModal.jsx'),
    leer('src/components/RegistrarDiagnosticoGestacionModal.jsx'), leer('src/components/RegistrarPartoModal.jsx'),
  ]);
  assert.match(seguimiento, /Este animal ya no está disponible para acciones reproductivas/);
  assert.match(seguimiento, /onVolverReproduccion\?\.\(\)/);
  assert.match(seguimiento, /data\.animal\.estado !== 'vivo'/);
  for (const formulario of [servicio, diagnostico, parto]) assert.match(formulario, /ANIMAL_REPRODUCTIVO_NO_DISPONIBLE/);
});

test('la vista de 390 px usa tarjetas sin scroll horizontal', async () => {
  const [css, reproduccion] = await Promise.all([leer('src/styles.css'), leer('src/components/Reproduccion.jsx')]);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /\.repro-screen \{[^}]*overflow-x: clip/);
  assert.match(css, /\.repro-attention-card \{ grid-template-columns: 1fr/);
  assert.match(css, /\.repro-choice-group > div \{ grid-template-columns: 1fr/);
  assert.doesNotMatch(reproduccion, /<table/);
  assert.match(reproduccion, /repro-attention-card/);
  assert.match(reproduccion, /repro-field-card/);
  assert.doesNotMatch(reproduccion, /repro-quick-actions/);
  assert.match(reproduccion, /No hay vacas pendientes de diagnóstico/);
});

test('el registro individual siempre es descubrible y busca por arete, nombre o corral', async () => {
  const [pantalla, estilos] = await Promise.all([leer('src/components/Reproduccion.jsx'), leer('src/styles.css')]);
  assert.match(pantalla, /\+ Registrar evento/);
  assert.match(pantalla, /Selecciona una vaca/);
  assert.match(pantalla, /arete, nombre o corral/i);
  assert.match(pantalla, /Registrar primer servicio/);
  assert.match(pantalla, /fila\.accion\.etiqueta/);
  assert.match(pantalla, /repro-mobile-register/);
  assert.match(estilos, /\.repro-picker-results article \{[^}]*grid-template-columns/);
  assert.match(estilos, /@media \(max-width: 600px\)[\s\S]*\.repro-mobile-register/);
  assert.match(estilos, /\.repro-search input \{[^}]*min-height: 48px/);
});

test('el mapeo Excel acepta encabezados distintos, columnas extras y datos incompletos sin inventarlos', () => {
  const encabezados = ['ID Vaca', 'Monta', 'Palpación', 'Resultado palpación', 'Comentario libre', 'Columna extra'];
  const sugerido = sugerirMapeoReproductivo(encabezados);
  assert.equal(sugerido.fecha_servicio, '1');
  assert.equal(sugerido.fecha_diagnostico, '2');
  assert.equal(sugerido.resultado_diagnostico, '3');
  const mapeo = { arete_vaca: '0', fecha_servicio: '1', fecha_diagnostico: '2', resultado_diagnostico: '3', observaciones: '4' };
  const filas = normalizarFilasReproductivas([['A-22', '2025-01-10', '2025-02-20', 'Preñada', 'Registro viejo', 'ignorar']], mapeo);
  assert.equal(filas[0].arete_vaca, 'A-22');
  assert.equal(filas[0].metodo, '');
  assert.equal(filas[0].arete_toro, '');
  assert.equal(Object.hasOwn(filas[0], 'Columna extra'), false);
});

test('P3 separa captura, importación guiada y exportación con confirmación atómica', async () => {
  const [pantalla, componente, apiFuente, estilos, exportaciones] = await Promise.all([
    leer('src/components/Reproduccion.jsx'), leer('src/components/ReproduccionMasiva.jsx'), leer('src/api.js'),
    leer('src/styles.css'), leer('src/exportUtils.js'),
  ]);
  assert.match(pantalla, /Captura masiva/);
  assert.match(pantalla, /Importar Excel/);
  assert.match(componente, /fecha\/responsable comunes|Datos comunes/);
  assert.match(componente, /Guardar en lote y siguiente animal/);
  assert.match(componente, /Preñada/);
  assert.match(componente, /Palpación/);
  assert.match(componente, /Ultrasonido/);
  assert.match(componente, /Cargar archivo.*Mapear columnas.*Normalizar.*Validar.*Vista previa.*Confirmar.*Importar/s);
  assert.match(componente, /Confirmar lote completo/);
  assert.match(componente, /no se escribirá nada/i);
  assert.match(apiFuente, /reproduccion\/lotes\/validar/);
  assert.match(apiFuente, /reproduccion\/lotes\/confirmar/);
  assert.match(exportaciones, /exportarReproduccionExcel/);
  assert.match(estilos, /@media \(max-width:390px\).*\.repro-bulk-workspace/s);
  assert.doesNotMatch(componente, /<table/);
});

test('P4 presenta indicadores explicables, drill-down y sementales sin rankings ni tablas anchas', async () => {
  const [pantalla, analitica, apiFuente, estilos] = await Promise.all([
    leer('src/components/Reproduccion.jsx'), leer('src/components/ReproduccionAnalitica.jsx'),
    leer('src/api.js'), leer('src/styles.css'),
  ]);
  assert.match(pantalla, /ReproduccionAnalitica/);
  assert.match(analitica, /Cada cifra muestra su muestra, exclusiones y nivel de completitud/);
  assert.match(analitica, /Datos insuficientes/);
  assert.match(analitica, /diagnósticos definitivos/);
  assert.match(analitica, /servicio de concepción puede identificarse/);
  assert.match(analitica, /Abortos y pérdidas/);
  assert.match(analitica, /Conjunto exacto/);
  assert.match(analitica, /No se asignan rankings/);
  assert.match(analitica, /Ver genealogía y seguimiento/);
  assert.doesNotMatch(analitica, /Mejor toro|score/i);
  assert.doesNotMatch(analitica, /<table/);
  assert.match(apiFuente, /reproduccion\/analitica\/resumen/);
  assert.match(apiFuente, /reproduccion\/analitica\/drill-down/);
  assert.match(apiFuente, /reproduccion\/analitica\/sementales/);
  assert.match(estilos, /@media \(max-width: 390px\)[\s\S]*\.repro-analysis-grid/);
  assert.match(estilos, /\.repro-analysis[\s\S]*overflow-x: hidden/);
});
