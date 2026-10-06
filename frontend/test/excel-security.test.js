import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import writeExcelFile from 'write-excel-file/node';
import { MAX_EXCEL_BYTES, validarTamanoExcel } from '../src/excelSecurity.js';
import { ENCABEZADOS_IMPORTACION_ANIMALES, leerExcelAnimales } from '../src/exportUtils.js';

let directorioTemporal;

before(async () => { directorioTemporal = await mkdtemp(join(tmpdir(), 'el-rancho-xlsx-')); });
after(async () => { await rm(directorioTemporal, { recursive: true, force: true }); });

async function libroReal(nombre, filas, opciones = {}) {
  const ruta = join(directorioTemporal, `${nombre}.xlsx`);
  await writeExcelFile(filas, { sheet: 'Animales', ...opciones }).toFile(ruta);
  const contenido = await readFile(ruta);
  return contenido.buffer.slice(contenido.byteOffset, contenido.byteOffset + contenido.byteLength);
}

test('la importación Excel acepta hasta 5 MB y rechaza archivos mayores', () => {
  assert.equal(MAX_EXCEL_BYTES, 5 * 1024 * 1024);
  assert.equal(validarTamanoExcel(MAX_EXCEL_BYTES), null);
  assert.equal(validarTamanoExcel(MAX_EXCEL_BYTES + 1), 'El archivo Excel no puede superar 5 MB.');
  assert.match(validarTamanoExcel(Number.NaN), /determinar el tamaño/);
});

test('lee un archivo .xlsx real con encabezados correctos y celdas opcionales vacías', async () => {
  const archivo = await libroReal('valido', [
    ENCABEZADOS_IMPORTACION_ANIMALES,
    ['MX-100', null, 'hembra', '2025-03-15', null, 32.5, 'nacimiento', null],
  ]);
  const animales = await leerExcelAnimales(archivo);
  assert.deepEqual(animales, [{
    fila: 2, arete_id: 'MX-100', nombre_alias: '', sexo: 'hembra', fecha_nacimiento: '2025-03-15',
    raza: '', peso_nacimiento_kg: '32.5', origen: 'nacimiento', corral: '',
  }]);
});

test('acepta números como número o texto y fechas Excel o ISO', async () => {
  const archivo = await libroReal('tipos', [
    ENCABEZADOS_IMPORTACION_ANIMALES,
    ['MX-101', '', 'macho', { value: new Date(2024, 6, 9), type: Date, format: 'yyyy-mm-dd' }, '', 41.25, 'compra', 'Norte'],
    ['MX-102', '', 'hembra', '2024-08-10', '', '39.75', 'nacimiento', 'Sur'],
  ], { dateFormat: 'yyyy-mm-dd' });
  const animales = await leerExcelAnimales(archivo);
  assert.equal(animales[0].fecha_nacimiento, '2024-07-09');
  assert.equal(animales[0].peso_nacimiento_kg, '41.25');
  assert.equal(animales[1].fecha_nacimiento, '2024-08-10');
  assert.equal(animales[1].peso_nacimiento_kg, '39.75');
});

test('ignora filas completamente vacías de un libro real', async () => {
  const archivo = await libroReal('filas-vacias', [
    ENCABEZADOS_IMPORTACION_ANIMALES,
    [null, null, null, null, null, null, null, null],
    ['MX-103', '', 'hembra', '', '', '', '', ''],
  ]);
  const animales = await leerExcelAnimales(archivo);
  assert.equal(animales.length, 1);
  assert.equal(animales[0].arete_id, 'MX-103');
});

for (const [caso, encabezados] of [
  ['faltantes', ENCABEZADOS_IMPORTACION_ANIMALES.slice(0, -1)],
  ['alterados', ENCABEZADOS_IMPORTACION_ANIMALES.map((valor, indice) => indice === 2 ? 'Sexo' : valor)],
  ['reordenados', [ENCABEZADOS_IMPORTACION_ANIMALES[1], ENCABEZADOS_IMPORTACION_ANIMALES[0], ...ENCABEZADOS_IMPORTACION_ANIMALES.slice(2)]],
]) {
  test(`rechaza encabezados ${caso}`, async () => {
    const archivo = await libroReal(`encabezados-${caso}`, [encabezados, ['MX-104']]);
    await assert.rejects(leerExcelAnimales(archivo), /ENCABEZADOS_EXCEL_INVALIDOS/);
  });
}

test('rechaza un libro real sin hoja utilizable y contenido que no es xlsx', async () => {
  const vacio = await libroReal('sin-datos', []);
  await assert.rejects(leerExcelAnimales(vacio), /LIBRO_EXCEL_SIN_HOJA_UTILIZABLE/);
  const invalido = new TextEncoder().encode('esto no es un libro xlsx').buffer;
  await assert.rejects(leerExcelAnimales(invalido));
});
