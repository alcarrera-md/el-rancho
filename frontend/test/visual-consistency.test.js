import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const componentes = new URL('../src/components/', import.meta.url);

async function fuente(nombre) {
  return readFile(new URL(nombre, componentes), 'utf8');
}

test('los seis módulos auditados explican su propósito con la presentación guiada', async () => {
  const archivos = ['Pesajes.jsx', 'Sanidad.jsx', 'Alimentacion.jsx', 'VentasReporte.jsx', 'ComprasList.jsx', 'BitacoraList.jsx'];
  for (const archivo of archivos) {
    const contenido = await fuente(archivo);
    assert.match(contenido, /PresentacionPantalla/, `${archivo} debe explicar el propósito de la pantalla`);
  }
});

test('los módulos densos usan selección de detalle y no presentan todos sus bloques a la vez', async () => {
  for (const archivo of ['Pesajes.jsx', 'Sanidad.jsx', 'VentasReporte.jsx', 'ComprasList.jsx']) {
    const contenido = await fuente(archivo);
    assert.match(contenido, /SelectorDetalle/, `${archivo} debe ofrecer una selección progresiva del detalle`);
  }
});

test('filtros secundarios y auditoría permanecen disponibles bajo demanda', async () => {
  const alimentacion = await fuente('Alimentacion.jsx');
  const ventas = await fuente('VentasReporte.jsx');
  const compras = await fuente('ComprasList.jsx');
  const bitacora = await fuente('BitacoraList.jsx');

  assert.match(alimentacion, /module-toolbar-details/);
  assert.match(ventas, /module-toolbar-details/);
  assert.match(compras, /module-toolbar-details/);
  assert.match(bitacora, /module-toolbar-details/);
  assert.match(bitacora, /className="audit-day"/);
  assert.match(bitacora, /Ver cambios registrados/);
  assert.match(bitacora, /JSON\.stringify\(detalle, null, 2\)/);
});

test('el selector compartido comunica por teclado y tecnologías de asistencia la vista activa', async () => {
  const presentacion = await fuente('PresentacionGuiada.jsx');
  assert.match(presentacion, /role="group"/);
  assert.match(presentacion, /aria-pressed=\{valor === opcion\.id\}/);
  assert.match(presentacion, /type="button"/);
});
