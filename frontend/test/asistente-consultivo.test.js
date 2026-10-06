import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const leer = (ruta) => fs.readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');

test('chat P5 renderiza contrato estructurado y ya no ofrece confirmaciones mutantes', async () => {
  const [chat, api, permisos] = await Promise.all([
    leer('src/components/ChatFlotante.jsx'), leer('src/api.js'), leer('src/authorization/permissions.js'),
  ]);
  assert.match(chat, /data\.destacado/);
  assert.match(chat, /data\.lista/);
  assert.match(chat, /data\.tabla/);
  assert.match(chat, /data\.advertencia/);
  assert.match(chat, /data\.acciones/);
  assert.match(chat, /drill_down_reproductivo/);
  assert.match(chat, /obtenerDetalleMetricaReproductiva/);
  // Ruta real del seguimiento; /seguimiento/animal/:id no existe en el router.
  assert.match(chat, /navigate\(`\/animales\/\$\{item\.animal_id\}\/seguimiento\?seccion=reproduccion`\)/);
  assert.doesNotMatch(chat, /\/seguimiento\/animal\//);
  assert.doesNotMatch(chat, /Confirmar|resolverConfirmacion|confirmacion/);
  assert.doesNotMatch(api, /confirmarAccionIA/);
  assert.doesNotMatch(permisos, /confirmar:\s*\[/);
});

test('asistente permanece online-only y el detalle usa filtros de P4 sin lógica paralela', async () => {
  const [app, chat, soporte] = await Promise.all([
    leer('src/App.jsx'), leer('src/components/ChatFlotante.jsx'), leer('src/offline/support.js'),
  ]);
  assert.match(app, /!sinConexion[^\n]+<ChatFlotante/);
  assert.match(chat, /api\.obtenerDetalleMetricaReproductiva\(accion\.metrica, \{ \.\.\.accion\.filtros/);
  assert.doesNotMatch(chat, /indexedDB|obtenerSnapshot|offline/i);
  assert.doesNotMatch(soporte, /reproduccion\s*:/);
  assert.match(soporte, /POR_VISTA\[vista\] \|\| SOPORTE_OFFLINE\.ONLINE_ONLY/);
});

test('la tabla del chat renderiza una celda de encabezado por columna del contrato', async () => {
  const [chat, estilos] = await Promise.all([leer('src/components/ChatFlotante.jsx'), leer('src/styles.css')]);
  assert.match(chat, /m\.tabla\.columnas\.map\(\(columna\) => <th key=\{columna\} scope="col">\{columna\}<\/th>\)/);
  assert.match(chat, /fila\.map\(\(celda, k\) => <td key=\{k\}>/);
  assert.match(estilos, /\.chat-table-wrap th,\.chat-table-wrap td \{ padding:\.35rem/);
});

test('UI mantiene botones y tablas contenidos en móvil', async () => {
  const estilos = await leer('src/styles.css');
  assert.match(estilos, /\.chat-table-wrap[^}]+overflow-x:auto/);
  assert.match(estilos, /\.chat-actions[^}]+flex-wrap:wrap/);
  assert.match(estilos, /@media \(max-width: 480px\)[^{]*\{[\s\S]*?\.chat-panel/);
});

test('P9.1: el chat reenvía solo el contexto firmado del último turno y ofrece opciones elegibles', async () => {
  const [chat, api] = await Promise.all([leer('src/components/ChatFlotante.jsx'), leer('src/api.js')]);
  assert.match(api, /consultarAsistente: \(mensaje, historial, contexto = null\)/);
  assert.match(api, /\.\.\.\(contexto \? \{ contexto \} : \{\}\)/);
  assert.match(chat, /api\.consultarAsistente\(contenido, historial, contexto\)/);
  assert.match(chat, /setContexto\(data\.contexto \|\| null\)/);
  // La opción envía su valor (arete) y muestra su etiqueta legible.
  assert.match(chat, /onClick=\{\(\) => enviar\(opcion\.valor, opcion\.etiqueta\)\}/);
  assert.match(chat, /i === mensajes\.length - 1/);
});

test('P9.1 UX: destacado con separador visible y acciones como elementos de lista separados', async () => {
  const [chat, estilos] = await Promise.all([leer('src/components/ChatFlotante.jsx'), leer('src/styles.css')]);
  assert.match(chat, /<strong>\{m\.destacado\.valor\}<\/strong><span className="chat-highlight-sep" aria-hidden="true">·<\/span><span>\{m\.destacado\.etiqueta\}<\/span>/);
  assert.match(chat, /<ul className="chat-actions" aria-label="Ver detalle">\{m\.acciones\.map\(\(accion, j\) => <li key=/);
  assert.doesNotMatch(chat, /dangerouslySetInnerHTML/);
  assert.match(estilos, /\.chat-actions \{[^}]*list-style:none/);
});

test('UX chat: anclado a la derecha, bajo los modales, accesible y sin tapar el menú lateral', async () => {
  const [chat, estilos] = await Promise.all([leer('src/components/ChatFlotante.jsx'), leer('src/styles.css')]);
  const reglaBoton = estilos.match(/\n\.chat-boton-flotante \{[^}]+\}/)[0];
  const reglaPanel = estilos.match(/\n\.chat-panel \{[^}]+\}/)[0];
  // Lejos del sidebar: anclado a la derecha, nunca a la izquierda.
  for (const regla of [reglaBoton, reglaPanel]) {
    assert.match(regla, /right: max\(24px, env\(safe-area-inset-right\)\)/);
    assert.doesNotMatch(regla, /\bleft:/);
    // Debajo del fondo de los modales (z-index 50) y del menú móvil (70-90).
    assert.match(regla, /z-index: 45;/);
  }
  assert.match(estilos, /\.modal-backdrop \{[^}]*z-index: 50;/);
  // El último contenido de la pantalla no queda bajo el lanzador.
  assert.match(estilos, /body:has\(\.chat-boton-flotante\) \.main::after \{ content: ''; display: block; height: 72px; \}/);
  // Accesibilidad: diálogo con título, conversación anunciada, Escape y foco de vuelta al lanzador.
  assert.match(chat, /role="dialog" aria-modal="false" aria-labelledby=\{tituloId\}/);
  assert.match(chat, /role="log" aria-live="polite"/);
  assert.match(chat, /evento\.key === 'Escape'/);
  assert.match(chat, /lanzadorRef\.current\?\.focus\(\)/);
  assert.match(chat, /aria-label="Enviar pregunta"/);
  assert.match(chat, /<label className="sr-only" htmlFor=\{`\$\{tituloId\}-entrada`\}>/);
  // Estado vacío y sugerencias pedidas.
  for (const sugerencia of ['¿Cómo va el rancho hoy?', '¿Qué animales necesitan atención?', '¿Cuántas vacas tengo?', '¿Qué tareas tengo pendientes?']) assert.ok(chat.includes(sugerencia), sugerencia);
  assert.match(chat, /Consulta información de tus animales, salud, tareas, reproducción, inventario y más\./);
  // Avisos diferenciados: degradado frente a nota y error.
  assert.match(chat, /chat-aviso-\$\{tipoAviso\(m\.advertencia\)\}/);
  assert.match(estilos, /\.chat-aviso-degradado \{/);
  assert.match(estilos, /@media \(prefers-reduced-motion: reduce\)/);
});
