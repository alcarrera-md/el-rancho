import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const leer = (ruta) => fs.readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');

test('P6 expone analítica económica sin integrarla todavía al catálogo de Gemini', async () => {
  const [api, componente, asistente] = await Promise.all([
    leer('src/api.js'), leer('src/components/ReproduccionEconomica.jsx'), leer('../backend/src/asistenteReproduccionService.js'),
  ]);
  assert.match(api, /costos-reproductivos\/analitica\/resumen/);
  assert.match(componente, /Costo por preñez/);
  assert.match(componente, /Costo por parto/);
  assert.match(componente, /Datos incompletos/);
  assert.doesNotMatch(asistente, /costos-reproductivos|costo_por_prenez|gasto reproductivo/i);
});

test('captura económica es opcional, compacta y restringida por permiso financiero', async () => {
  const [campo, servicio, diagnostico, parto, permisos] = await Promise.all([
    leer('src/components/CostoReproductivoOpcional.jsx'), leer('src/components/RegistrarMontaModal.jsx'),
    leer('src/components/RegistrarDiagnosticoGestacionModal.jsx'), leer('src/components/RegistrarPartoModal.jsx'),
    leer('src/authorization/permissions.js'),
  ]);
  assert.match(campo, /Costos \(opcional\)/);
  assert.match(campo, /Déjalo vacío/);
  for (const fuente of [servicio, diagnostico, parto]) {
    assert.match(fuente, /costos_reproductivos/);
    assert.match(fuente, /CostoReproductivoOpcional/);
  }
  assert.match(permisos, /costos_reproductivos: \{ leer: \[A, U\], crear: \[A\]/);
});

test('la vista económica mantiene responsive sin tabla ni scroll horizontal', async () => {
  const [componente, estilos] = await Promise.all([leer('src/components/ReproduccionEconomica.jsx'), leer('src/styles.css')]);
  assert.doesNotMatch(componente, /<table/);
  assert.match(estilos, /\.repro-economic-grid/);
  assert.match(estilos, /@media \(max-width: 430px\)/);
});
