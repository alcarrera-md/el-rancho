import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import {
  exportarComprasAnimalPDF, exportarEtiquetasQR, exportarFichaPDF, exportarHistorialTercero,
  exportarListaAnimalesPDF, exportarListaTareasPDF, exportarListaVacunasPDF,
  exportarReporteEjecutivo, exportarVentasPDF,
} from '../src/exportUtils.js';

const documentos = [];
jsPDF.API.save = function guardarEnMemoria(nombre) {
  const bytes = new Uint8Array(this.output('arraybuffer'));
  documentos.push({ nombre, bytes, paginas: this.getNumberOfPages() });
  return this;
};

globalThis.window = { location: { origin: 'https://ganado.test' } };

const fecha = '2026-08-27';
const animales = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, arete_id: `MX-${String(i + 1).padStart(3, '0')}`, nombre_alias: `Animal ${i + 1}`, corral_actual: 'Norte' }));

test('todas las exportaciones PDF conservan contenido, nombres, tablas, páginas e imágenes', async () => {
  await exportarHistorialTercero({ nombre: 'Proveedor Uno' }, {
    ventas: [{ fecha, arete_id: 'MX-001', precio: 1200 }],
    compras: [{ fecha, arete_id: 'MX-002', precio: 900, animal_estado: 'vivo', estado_salud: 'sano' }],
    saludResumen: '1 sano',
  });
  await exportarReporteEjecutivo({
    resumen: { total_animales_vivos: 10, tasa_mortalidad: 1, tasa_prenez: 80, tasa_destete: 90, ganancia_diaria_promedio_kg: 0.7 },
    financiero: { ingresos: { total: 1200 }, gastos: { total: 500 }, utilidad_neta: 700 },
    alertas: { vacunas_proximas: 1, stock_bajo: 2, tareas_pendientes: 3, partos_proximos: 1 },
  });
  await exportarEtiquetasQR(animales);
  await exportarFichaPDF({ arete_id: 'MX-001', nombre_alias: 'Luna', sexo: 'hembra', raza: 'Brahman', fecha_nacimiento: fecha, corral_actual: 'Norte', estado: 'vivo' }, [
    { fecha, tipo: 'pesaje', detalle: { peso_kg: 350, observacion: 'Control mensual' } },
  ]);
  await exportarListaAnimalesPDF(animales, 'Norte');
  await exportarListaTareasPDF(Array.from({ length: 140 }, (_, i) => ({ fecha, descripcion: `Tarea ${i + 1}`, trabajador: 'Operador', corral: 'Norte' })));
  await exportarListaVacunasPDF([{ fecha, proxima_dosis: fecha, arete_id: 'MX-001', tipo: 'vacuna' }]);
  await exportarVentasPDF([{ fecha, arete_id: 'MX-001', comprador: 'Cliente', precio: 1200 }], 1200, 'Periodo de prueba');
  await exportarComprasAnimalPDF([{ fecha, arete_id: 'MX-002', proveedor: 'Proveedor', precio: 900, identificacion_previa: 'EXT-2' }], 'Periodo de prueba');

  assert.deepEqual(documentos.map((doc) => doc.nombre), [
    'historial-proveedor-uno.pdf', 'reporte-ejecutivo.pdf', 'etiquetas-qr.pdf', 'ficha-MX-001.pdf',
    'lista-animales.pdf', 'lista-tareas.pdf', 'lista-vacunas.pdf', 'reporte-ventas.pdf', 'reporte-compras-animales.pdf',
  ]);
  for (const doc of documentos) {
    assert.equal(new TextDecoder().decode(doc.bytes.slice(0, 5)), '%PDF-', `${doc.nombre} debe ser un PDF válido`);
    assert.ok(doc.bytes.length > 500, `${doc.nombre} no debe quedar vacío`);
  }
  assert.ok(documentos.find((doc) => doc.nombre === 'lista-tareas.pdf').paginas > 1, 'la lista extensa debe paginarse');
  const etiquetas = documentos.find((doc) => doc.nombre === 'etiquetas-qr.pdf');
  assert.equal(etiquetas.paginas, 2, 'diez etiquetas deben paginarse en dos hojas');
  assert.ok(etiquetas.bytes.length > 10_000, 'el PDF de etiquetas debe contener las imágenes QR');
  assert.ok(documentos.some((doc) => new TextDecoder().decode(doc.bytes).includes('MX-001')), 'las tablas deben conservar el contenido ganadero');
});
