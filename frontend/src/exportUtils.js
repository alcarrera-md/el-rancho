let promesaPdf;
let promesaLectorExcel;
let promesaEscritorExcel;
let promesaQr;

async function cargarPdf() {
  promesaPdf ||= Promise.all([import('jspdf'), import('jspdf-autotable')])
    .then(([pdf, tabla]) => ({ jsPDF: pdf.jsPDF, autoTable: tabla.autoTable }));
  return promesaPdf;
}

async function cargarLectorExcel() {
  promesaLectorExcel ||= import('read-excel-file/browser').then((modulo) => modulo.readSheet);
  return promesaLectorExcel;
}

async function cargarEscritorExcel() {
  promesaEscritorExcel ||= import('write-excel-file/browser').then((modulo) => modulo.default);
  return promesaEscritorExcel;
}

async function cargarQr() {
  promesaQr ||= import('qrcode').then((modulo) => modulo.default);
  return promesaQr;
}

function formatearFecha(fecha) {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------
// Historial de compras o ventas con un proveedor/comprador específico → PDF
// ---------------------------------------------------------
export async function exportarHistorialTercero(tercero, { ventas, compras, saludResumen }) {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text(`Historial con ${tercero.nombre}`, 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text(formatearFecha(new Date()), 14, 26);
  doc.setTextColor(0);
  let y = 36;

  if (ventas && ventas.length > 0) {
    doc.setFontSize(13);
    doc.text('Ventas', 14, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [['Fecha', 'Arete', 'Precio']],
      body: ventas.map((v) => [formatearFecha(v.fecha), v.arete_id, `$${Number(v.precio).toLocaleString('es-MX')}`]),
      headStyles: { fillColor: [47, 82, 51] },
      styles: { fontSize: 10 },
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  if (compras && compras.length > 0) {
    doc.setFontSize(13);
    doc.text('Compras', 14, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [['Fecha', 'Arete', 'Precio', 'Estado de salud actual']],
      body: compras.map((c) => [formatearFecha(c.fecha), c.arete_id, c.precio ? `$${Number(c.precio).toLocaleString('es-MX')}` : '—', c.animal_estado !== 'vivo' ? c.animal_estado : (c.estado_salud || 'sano')]),
      headStyles: { fillColor: [47, 82, 51] },
      styles: { fontSize: 10 },
    });
    y = doc.lastAutoTable.finalY + 12;

    if (saludResumen) {
      doc.setFontSize(11);
      doc.text(`Resumen de salud: ${saludResumen}`, 14, y);
    }
  }

  doc.save(`historial-${tercero.nombre.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}

// ---------------------------------------------------------
// Reporte ejecutivo — una sola página con lo más importante del
// rancho, pensado para imprimir o mandar a alguien de un vistazo.
// ---------------------------------------------------------
export async function exportarReporteEjecutivo({ resumen, financiero, alertas }) {
  const { jsPDF } = await cargarPdf();
  const doc = new jsPDF();
  const hoy = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  let y = 20;

  doc.setFillColor(47, 82, 51);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text('Reporte Ejecutivo del Rancho', 14, 17);
  doc.setFontSize(10);
  doc.text(hoy, 14, 24);
  doc.setTextColor(0, 0, 0);
  y = 42;

  function seccion(titulo) {
    doc.setFontSize(13);
    doc.setTextColor(47, 82, 51);
    doc.text(titulo, 14, y);
    doc.setDrawColor(201, 154, 46);
    doc.setLineWidth(0.6);
    doc.line(14, y + 2, 196, y + 2);
    doc.setTextColor(0, 0, 0);
    y += 10;
  }

  function fila(etiqueta, valor, resaltar) {
    doc.setFontSize(11);
    doc.setTextColor(90);
    doc.text(etiqueta, 16, y);
    doc.setTextColor(...(resaltar || [20, 20, 20]));
    doc.setFontSize(12);
    doc.text(String(valor), 196, y, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += 8;
  }

  seccion('Panorama del hato');
  fila('Animales vivos', resumen.total_animales_vivos);
  fila('Tasa de mortalidad', resumen.tasa_mortalidad !== null ? `${resumen.tasa_mortalidad}%` : 'Sin datos suficientes');
  fila('Tasa de preñez', resumen.tasa_prenez !== null ? `${resumen.tasa_prenez}%` : 'No disponible con los datos actuales');
  fila('Supervivencia de crías', resumen.tasa_destete !== null ? `${resumen.tasa_destete}%` : 'Sin datos suficientes');
  fila('Ganancia diaria promedio', resumen.ganancia_diaria_promedio_kg !== null ? `${resumen.ganancia_diaria_promedio_kg} kg/día` : 'Sin datos suficientes');
  y += 4;

  seccion('Finanzas');
  fila('Ingresos totales', `$${Number(financiero.ingresos.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
  fila('Gastos totales', `$${Number(financiero.gastos.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
  fila('Utilidad neta', `$${Number(financiero.utilidad_neta).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, financiero.utilidad_neta >= 0 ? [47, 82, 51] : [168, 65, 44]);
  y += 4;

  seccion('Estado operativo');
  fila('Vacunas próximas (30 días)', alertas.vacunas_proximas);
  fila('Insumos con stock bajo', alertas.stock_bajo);
  fila('Tareas pendientes', alertas.tareas_pendientes);
  fila('Partos próximos (30 días)', alertas.partos_proximos);

  doc.setFontSize(9);
  doc.setTextColor(140);
  doc.text('Generado automáticamente por el Sistema de Gestión Ganadera', 14, 285);

  doc.save('reporte-ejecutivo.pdf');
}

// ---------------------------------------------------------
// Enlace directo a un animal (para el código QR). Al escanearlo, abre el
// sistema y lo lleva directo a su seguimiento. Usa la dirección desde la
// que se está viendo el sistema en este momento (funciona igual en la red
// local que el día que esto viva en internet).
// ---------------------------------------------------------
export function enlaceAnimal(animalId) {
  return `${window.location.origin}/animales/${encodeURIComponent(animalId)}/seguimiento`;
}

export async function generarQRDataURL(animalId) {
  const QRCode = await cargarQr();
  return QRCode.toDataURL(enlaceAnimal(animalId), { margin: 1, width: 240 });
}

// Hoja de etiquetas QR para imprimir y pegar en el corral/oreja del
// animal — varias por hoja, listas para recortar.
export async function exportarEtiquetasQR(animales) {
  const { jsPDF } = await cargarPdf();
  const doc = new jsPDF();
  const cols = 3;
  const anchoCelda = 62;
  const altoCelda = 70;
  const margenX = 12;
  const margenY = 14;

  doc.setFontSize(14);
  doc.text('Etiquetas QR — escanea para abrir el seguimiento del animal', margenX, 10);

  for (let i = 0; i < animales.length; i++) {
    const a = animales[i];
    const col = i % cols;
    const filaEnPagina = Math.floor(i / cols) % 3;
    if (i > 0 && col === 0 && filaEnPagina === 0) doc.addPage();

    const x = margenX + col * anchoCelda;
    const y = margenY + filaEnPagina * altoCelda + 6;

    const qrDataUrl = await generarQRDataURL(a.id);
    doc.addImage(qrDataUrl, 'PNG', x, y, 46, 46);
    doc.setFontSize(11);
    doc.text(a.arete_id, x + 23, y + 53, { align: 'center' });
    if (a.nombre_alias) {
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(a.nombre_alias, x + 23, y + 59, { align: 'center' });
      doc.setTextColor(0);
    }
  }

  doc.save('etiquetas-qr.pdf');
}

const ETIQUETAS_TIPO = {
  pesaje: 'Pesaje',
  salud: 'Evento de salud',
  alimentacion: 'Alimentación',
  reproduccion: 'Evento reproductivo',
  movimiento: 'Movimiento de corral',
  leche: 'Producción de leche',
  condicion: 'Condición corporal',
  categoria: 'Cambio de categoría',
};

function descripcionEvento(tipo, detalle) {
  switch (tipo) {
    case 'pesaje':
      return `Peso: ${detalle.peso_kg} kg${detalle.observacion ? ` — ${detalle.observacion}` : ''}`;
    case 'salud':
      return `${detalle.tipo}${detalle.enfermedad ? ` — ${detalle.enfermedad}` : ''}`;
    case 'alimentacion':
      return `${detalle.cantidad} ${detalle.unidad_medida} de ${detalle.insumo}`;
    case 'leche':
      return `${detalle.litros} L${detalle.turno !== 'unico' ? ` (${detalle.turno})` : ''}`;
    case 'condicion':
      return `Puntuación: ${detalle.puntuacion}/5${detalle.observacion ? ` — ${detalle.observacion}` : ''}`;
    case 'categoria':
      return `${detalle.categoria_anterior ? `De ${detalle.categoria_anterior} a` : 'Asignada a'} ${detalle.categoria_nueva}`;
    case 'movimiento':
      return `${detalle.corral_origen ? `De ${detalle.corral_origen} a` : 'Ingresó a'} ${detalle.corral_destino}`;
    case 'reproduccion':
      return `Monta ${detalle.tipo_monta} — ${detalle.fecha_parto_real ? `parto: ${formatearFecha(detalle.fecha_parto_real)}` : `estimado: ${formatearFecha(detalle.fecha_parto_estimada)}`}`;
    default:
      return '';
  }
}

// ---------------------------------------------------------
// Ficha de animal → PDF
// ---------------------------------------------------------
export async function exportarFichaPDF(animal, timeline) {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text(`Ficha del animal ${animal.arete_id}`, 14, 18);

  doc.setFontSize(10);
  doc.setTextColor(90);
  const lineas = [
    `Nombre: ${animal.nombre_alias || '—'}`,
    `Sexo: ${animal.sexo === 'hembra' ? 'Hembra' : 'Macho'}   Raza: ${animal.raza || '—'}`,
    `Nació: ${formatearFecha(animal.fecha_nacimiento)}   Corral actual: ${animal.corral_actual || '—'}`,
    `Estado: ${animal.estado}`,
  ];
  lineas.forEach((linea, i) => doc.text(linea, 14, 27 + i * 6));

  autoTable(doc, {
    startY: 27 + lineas.length * 6 + 6,
    head: [['Fecha', 'Tipo', 'Detalle']],
    body: timeline.map((e) => [formatearFecha(e.fecha), ETIQUETAS_TIPO[e.tipo] || e.tipo, descripcionEvento(e.tipo, e.detalle)]),
    headStyles: { fillColor: [47, 82, 51] }, // var(--pasture)
    styles: { fontSize: 9 },
  });

  doc.save(`ficha-${animal.arete_id}.pdf`);
}

// ---------------------------------------------------------
// Lista de animales para revisión en campo → PDF
// (con columnas en blanco para anotar a mano: peso, observaciones)
// ---------------------------------------------------------
export async function exportarListaAnimalesPDF(animales, tituloCorral) {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Lista de animales para revisión', 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text(`${tituloCorral || 'Todos los animales vivos'} — ${formatearFecha(new Date())} — ${animales.length} animal(es)`, 14, 27);

  autoTable(doc, {
    startY: 34,
    head: [['Arete', 'Alias', 'Corral', 'Peso (kg)', 'Observaciones']],
    body: animales.map((a) => [a.arete_id, a.nombre_alias || '—', a.corral_actual || '—', '', '']),
    headStyles: { fillColor: [47, 82, 51] },
    styles: { fontSize: 10, minCellHeight: 10 },
    columnStyles: { 3: { cellWidth: 30 }, 4: { cellWidth: 55 } },
  });

  doc.save('lista-animales.pdf');
}

// ---------------------------------------------------------
// Lista de tareas pendientes → PDF (con casilla para marcar hecho)
// ---------------------------------------------------------
export async function exportarListaTareasPDF(tareas) {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Tareas pendientes', 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text(`${formatearFecha(new Date())} — ${tareas.length} tarea(s)`, 14, 27);

  autoTable(doc, {
    startY: 34,
    head: [['✓', 'Fecha', 'Descripción', 'Trabajador', 'Corral']],
    body: tareas.map((t) => ['☐', formatearFecha(t.fecha), t.descripcion, t.trabajador, t.corral || '—']),
    headStyles: { fillColor: [47, 82, 51] },
    styles: { fontSize: 10 },
    columnStyles: { 0: { cellWidth: 10, halign: 'center', fontSize: 13 } },
  });

  doc.save('lista-tareas.pdf');
}

// ---------------------------------------------------------
// Lista de vacunas próximas → PDF (con casilla para marcar aplicada)
// ---------------------------------------------------------
export async function exportarListaVacunasPDF(vacunas) {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Vacunas / dosis próximas', 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text(`${formatearFecha(new Date())} — ${vacunas.length} pendiente(s)`, 14, 27);

  autoTable(doc, {
    startY: 34,
    head: [['✓', 'Arete', 'Tipo', 'Fecha programada']],
    body: vacunas.map((v) => ['☐', v.arete_id, v.tipo, formatearFecha(v.proxima_dosis)]),
    headStyles: { fillColor: [47, 82, 51] },
    styles: { fontSize: 10 },
    columnStyles: { 0: { cellWidth: 10, halign: 'center', fontSize: 13 } },
  });

  doc.save('lista-vacunas.pdf');
}

// ---------------------------------------------------------
// Plantilla de importación masiva de animales → Excel
// ---------------------------------------------------------
export const ENCABEZADOS_IMPORTACION_ANIMALES = Object.freeze([
  'Arete*',
  'Nombre (alias)',
  'Sexo* (hembra/macho)',
  'Fecha de nacimiento (AAAA-MM-DD)',
  'Raza',
  'Peso al nacer (kg)',
  'Origen (nacimiento/compra)',
  'Corral',
]);

function filasDesdeObjetos(filas) {
  if (!filas.length) return [];
  const encabezados = Object.keys(filas[0]);
  return [encabezados, ...filas.map((fila) => encabezados.map((encabezado) => fila[encabezado] ?? null))];
}

export async function exportarPlantillaImportacion() {
  const escribirExcel = await cargarEscritorExcel();
  const ejemplo = ['MX-0010', 'Manchas', 'hembra', '2025-03-15', 'Brahman', '32.5', 'nacimiento', 'Corral Crianza A'];
  await escribirExcel([ENCABEZADOS_IMPORTACION_ANIMALES, ejemplo], {
    sheet: 'Animales',
    columns: [12, 16, 18, 26, 14, 14, 20, 18].map((width) => ({ width })),
    stickyRowsCount: 1,
  }).toFile('plantilla-importacion-animales.xlsx');
}

// ---------------------------------------------------------
// Convierte un número de serie de fecha de Excel a texto AAAA-MM-DD
// (por si la celda quedó formateada como fecha en vez de texto)
// ---------------------------------------------------------
function excelFechaATexto(valor) {
  if (valor === undefined || valor === null || valor === '') return '';
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const pad = (numero) => String(numero).padStart(2, '0');
    return `${valor.getFullYear()}-${pad(valor.getMonth() + 1)}-${pad(valor.getDate())}`;
  }
  const texto = String(valor).trim();
  if (/^\d+(\.\d+)?$/.test(texto)) {
    const serial = Number(texto);
    if (serial > 0 && Number.isFinite(serial)) {
      const fecha = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
      const pad = (n) => String(n).padStart(2, '0');
      return `${fecha.getUTCFullYear()}-${pad(fecha.getUTCMonth() + 1)}-${pad(fecha.getUTCDate())}`;
    }
  }
  return texto;
}

function validarEncabezadosImportacion(fila) {
  const recibidos = Array.isArray(fila) ? fila.map((valor) => String(valor ?? '').trim()) : [];
  const sonExactos = recibidos.length === ENCABEZADOS_IMPORTACION_ANIMALES.length
    && ENCABEZADOS_IMPORTACION_ANIMALES.every((encabezado, indice) => recibidos[indice] === encabezado);
  if (!sonExactos) {
    throw new Error(`ENCABEZADOS_EXCEL_INVALIDOS: usa exactamente estas columnas y en este orden: ${ENCABEZADOS_IMPORTACION_ANIMALES.join(' | ')}`);
  }
}

// ---------------------------------------------------------
// Lee un archivo Excel subido por el usuario y lo convierte en
// una lista de animales lista para enviar al backend
// ---------------------------------------------------------
export async function leerExcelAnimales(arrayBuffer) {
  const leerHoja = await cargarLectorExcel();
  const filas = await leerHoja(arrayBuffer);
  if (!Array.isArray(filas) || filas.length === 0) throw new Error('LIBRO_EXCEL_SIN_HOJA_UTILIZABLE');
  validarEncabezadosImportacion(filas[0]);

  return filas
    .slice(1) // se salta la fila de encabezados
    .filter((f) => f.length && String(f[0] || '').trim()) // se ignoran filas vacías
    .map((f, i) => ({
      fila: i + 2,
      arete_id: String(f[0] || '').trim(),
      nombre_alias: String(f[1] || '').trim(),
      sexo: String(f[2] || '').trim().toLowerCase(),
      fecha_nacimiento: excelFechaATexto(f[3]),
      raza: String(f[4] || '').trim(),
      peso_nacimiento_kg: String(f[5] || '').trim(),
      origen: String(f[6] || '').trim().toLowerCase(),
      corral: String(f[7] || '').trim(),
    }));
}

// Reproducción histórica usa mapeo guiado; por eso conserva encabezados y
// columnas extras en vez de exigir una plantilla exacta.
export async function leerExcelReproduccion(arrayBuffer) {
  const leerHoja = await cargarLectorExcel();
  const filas = await leerHoja(arrayBuffer);
  if (!Array.isArray(filas) || filas.length < 2) throw new Error('El archivo no contiene filas utilizables.');
  const encabezados = filas[0].map((valor, indice) => String(valor ?? '').trim() || `Columna ${indice + 1}`);
  return {
    encabezados,
    filas: filas.slice(1).filter((fila) => fila.some((valor) => valor !== null && valor !== undefined && String(valor).trim() !== '')),
    fechaATexto: excelFechaATexto,
  };
}

export async function exportarReproduccionExcel(datos, nombre = 'reproduccion') {
  const escribirExcel = await cargarEscritorExcel();
  const hojas = [
    ['Ciclos', datos.ciclos], ['Servicios', datos.servicios],
    ['Diagnósticos', datos.diagnosticos], ['Partos', datos.partos],
  ].filter(([, filas]) => filas?.length)
    .map(([sheet, filas]) => ({ data: filasDesdeObjetos(filas), sheet, stickyRowsCount: 1 }));
  if (!hojas.length) throw new Error('No hay registros reproductivos para exportar con estos filtros.');
  await escribirExcel(hojas.length === 1 ? hojas[0].data : hojas, hojas.length === 1 ? { sheet: hojas[0].sheet, stickyRowsCount: 1 } : undefined)
    .toFile(`${nombre}.xlsx`);
}

// ---------------------------------------------------------
// Reporte de ventas → PDF
// ---------------------------------------------------------
export async function exportarVentasPDF(ventas, totalIngresos, filtroTexto) {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Reporte de ventas', 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(90);
  let y = 27;
  if (filtroTexto) { doc.text(filtroTexto, 14, y); y += 6; }
  doc.text(`Ingresos totales: $${Number(totalIngresos).toLocaleString('es-MX')} — ${ventas.length} venta(s)`, 14, y);

  autoTable(doc, {
    startY: y + 7,
    head: [['Fecha', 'Arete', 'Comprador', 'Precio']],
    body: ventas.map((v) => [formatearFecha(v.fecha), v.arete_id, v.comprador, `$${Number(v.precio).toLocaleString('es-MX')}`]),
    headStyles: { fillColor: [47, 82, 51] },
  });

  doc.save('reporte-ventas.pdf');
}

// ---------------------------------------------------------
// Reporte de compras de animales → PDF (filtrable por proveedor/periodo)
// ---------------------------------------------------------
export async function exportarComprasAnimalPDF(compras, filtroTexto) {
  const { jsPDF, autoTable } = await cargarPdf();
  const doc = new jsPDF();
  const total = compras.reduce((s, c) => s + Number(c.precio || 0), 0);
  doc.setFontSize(18);
  doc.text('Reporte de compras de animales', 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(90);
  let y = 27;
  if (filtroTexto) { doc.text(filtroTexto, 14, y); y += 6; }
  doc.text(`Total invertido: $${total.toLocaleString('es-MX')} — ${compras.length} animal(es)`, 14, y);

  autoTable(doc, {
    startY: y + 7,
    head: [['Fecha', 'Arete', 'Proveedor', 'Precio', 'Identificación previa']],
    body: compras.map((c) => [
      formatearFecha(c.fecha), c.arete_id, c.proveedor,
      c.precio ? `$${Number(c.precio).toLocaleString('es-MX')}` : '—', c.identificacion_previa || '—',
    ]),
    headStyles: { fillColor: [47, 82, 51] },
  });

  doc.save('reporte-compras-animales.pdf');
}

// ---------------------------------------------------------
// Reporte de ventas → Excel
// ---------------------------------------------------------
export async function exportarVentasExcel(ventas) {
  const escribirExcel = await cargarEscritorExcel();
  const filas = ventas.map((v) => ({
    Fecha: formatearFecha(v.fecha),
    Arete: v.arete_id,
    Comprador: v.comprador,
    Precio: Number(v.precio),
  }));
  await escribirExcel(filasDesdeObjetos(filas), { sheet: 'Ventas', stickyRowsCount: 1 }).toFile('reporte-ventas.xlsx');
}

// ---------------------------------------------------------
// Reporte general (resumen) → Excel
// ---------------------------------------------------------
export async function exportarResumenExcel(data) {
  const escribirExcel = await cargarEscritorExcel();

  const kpis = [
    { Indicador: 'Animales vivos', Valor: data.total_animales_vivos },
    { Indicador: 'Ingresos totales', Valor: data.ingresos_totales },
    { Indicador: 'Tasa de mortalidad (%)', Valor: data.tasa_mortalidad },
    { Indicador: 'Tasa de preñez', Valor: data.tasa_prenez ?? 'No disponible con los datos actuales' },
    { Indicador: 'Supervivencia de crías (%)', Valor: data.tasa_destete },
    { Indicador: 'Ganancia diaria promedio (kg)', Valor: data.ganancia_diaria_promedio_kg },
  ];
  await escribirExcel([
    { data: filasDesdeObjetos(kpis), sheet: 'Resumen', stickyRowsCount: 1 },
    { data: filasDesdeObjetos(data.peso_promedio_por_corral), sheet: 'Peso por corral', stickyRowsCount: 1 },
    { data: filasDesdeObjetos(data.ventas_por_mes), sheet: 'Ventas por mes', stickyRowsCount: 1 },
  ]).toFile('reporte-general.xlsx');
}
