// Capa de colores del modo oscuro para las superficies con colores fijos.
//
// Muchos módulos declaran fondos, bordes y textos con colores literales
// pensados para el tema claro (#fff, #f8faf7, #17251d...). En vez de repetir a
// mano un override oscuro por cada regla, este script recorre styles.css y
// genera, dentro de [data-mode="oscuro"], el equivalente oscuro de cada color
// fijo: superficies claras -> superficies antracita (conservando el matiz de
// las tarjetas de alerta, aviso o éxito), bordes claros -> borde discreto y
// textos oscuros -> texto claro. El tema claro no cambia.
//
//   node scripts/tema-oscuro.mjs           regenera el bloque en styles.css
//   node scripts/tema-oscuro.mjs --check   falla si el bloque está desactualizado
//
// Solo se tocan propiedades de color; nunca tamaños, posiciones ni layout.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RUTA_ESTILOS = fileURLToPath(new URL('../src/styles.css', import.meta.url));
export const INICIO = '/* === MODO OSCURO · CAPA GENERADA (scripts/tema-oscuro.mjs) — no editar a mano === */';
export const FIN = '/* === FIN MODO OSCURO · CAPA GENERADA === */';

// Superficie base del modo oscuro (igual a --paper-raised oscuro) y borde.
const SUPERFICIE = [0x1d, 0x21, 0x25];
const BORDE = [0x30, 0x36, 0x3d];
// Zonas que ya son oscuras o tienen su propio tratamiento en ambos temas.
const EXCLUIDOS = /^body$|\.sidebar|\.mobile-topbar|\.mobile-menu|\.login|\.btn-primary|\.chat-boton-flotante|\.clima-tarjeta|::selection|\.pdf-|\.print-/;

function hex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

function luminancia([r, g, b]) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function croma(rgb) { return Math.max(...rgb) - Math.min(...rgb); }

function matiz([r, g, b]) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (!d) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function desdeHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function mezcla(a, b, t) { return a.map((v, i) => v * (1 - t) + b[i] * t); }

function leerColor(literal) {
  const texto = literal.toLowerCase();
  if (texto === 'white') return { rgb: [255, 255, 255], alfa: 1 };
  let m = texto.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), alfa: 1 };
  }
  m = texto.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alfa: m[4] === undefined ? 1 : Number(m[4]) };
  return null;
}

// Superficie clara -> superficie oscura. Los neutros pasan a tokens; los
// tintes (rojo de alerta, ámbar de aviso, verde de éxito) conservan su matiz.
// Los blancos cálidos (crema, beige) también cuentan como neutros: el fondo
// oscuro es antracita, no café.
function esNeutro(rgb) {
  const h = matiz(rgb);
  return croma(rgb) < 10 || (croma(rgb) < 22 && h >= 25 && h <= 65);
}

// Un blanco muy translúcido es un brillo sobre una zona ya oscura o de color
// (menú lateral, cabecera del chat, mapa): se deja igual. En un degradado se
// convierten desde 0.3 porque suelen ser desvanecidos sobre la superficie.
function superficieOscura(color, enDegradado = false) {
  const { rgb, alfa } = color;
  if (luminancia(rgb) < 205 || croma(rgb) > 70) return null;
  if (alfa < (enDegradado ? 0.3 : 0.5)) return null;
  if (alfa < 1) return esNeutro(rgb) ? `rgba(${SUPERFICIE.join(', ')}, ${alfa})` : null;
  if (esNeutro(rgb)) return luminancia(rgb) >= 250 ? 'var(--paper-raised)' : 'var(--cream-deep)';
  const tono = desdeHsl(matiz(rgb), 0.5, 0.5);
  return hex(mezcla(SUPERFICIE, tono, Math.min(0.2, 0.06 + croma(rgb) / 400)));
}

function bordeOscuro(color) {
  const { rgb, alfa } = color;
  if (alfa < 0.3 || luminancia(rgb) < 175) return null;
  if (croma(rgb) < 18) return 'var(--line)';
  return hex(mezcla(BORDE, desdeHsl(matiz(rgb), 0.45, 0.5), 0.35));
}

// Texto oscuro -> texto claro; los textos de color conservan su matiz.
function textoClaro(color) {
  const { rgb } = color;
  if (luminancia(rgb) >= 125) return null;
  if (croma(rgb) < 40) return luminancia(rgb) < 72 ? 'var(--ink)' : 'var(--ink-soft)';
  return hex(desdeHsl(matiz(rgb), 0.55, 0.72));
}

const RE_COLOR = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^()]*\)|\bwhite\b/g;

function reemplazarColores(valor, convertir) {
  let cambio = false;
  const nuevo = valor.replace(RE_COLOR, (literal) => {
    const color = leerColor(literal);
    const oscuro = color && convertir(color);
    if (!oscuro) return literal;
    cambio = true;
    return oscuro;
  });
  return cambio ? nuevo : null;
}

function gradientes(valor) {
  const lista = [];
  const re = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/g;
  let m;
  while ((m = re.exec(valor))) {
    let nivel = 0; let i = m.index + m[0].length - 1;
    for (; i < valor.length; i += 1) {
      if (valor[i] === '(') nivel += 1;
      else if (valor[i] === ')') { nivel -= 1; if (nivel === 0) break; }
    }
    lista.push(valor.slice(m.index, i + 1));
    re.lastIndex = i + 1;
  }
  return lista;
}

function sinComentarios(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

// Recorre reglas (incluidas las de @media) y omite @keyframes/@font-face.
export function leerReglas(css) {
  const reglas = [];
  function recorrer(texto, media) {
    let i = 0;
    while (i < texto.length) {
      const abre = texto.indexOf('{', i);
      if (abre < 0) break;
      const preludio = texto.slice(i, abre).trim();
      let nivel = 1; let j = abre + 1;
      for (; j < texto.length && nivel; j += 1) {
        if (texto[j] === '{') nivel += 1; else if (texto[j] === '}') nivel -= 1;
      }
      const cuerpo = texto.slice(abre + 1, j - 1);
      if (preludio.startsWith('@media')) {
        if (!/print/.test(preludio)) recorrer(cuerpo, preludio);
      } else if (!preludio.startsWith('@')) {
        reglas.push({ media, selector: preludio.replace(/\s+/g, ' '), cuerpo });
      }
      i = j;
    }
  }
  recorrer(sinComentarios(css), null);
  return reglas;
}

function declaraciones(cuerpo) {
  return cuerpo.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const k = d.indexOf(':');
    return k < 0 ? null : [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).replace(/!important/, '').trim()];
  }).filter(Boolean);
}

const FONDO_NEUTRO = /^(?:var\(--(?:paper|paper-raised|cream-deep|pasture-soft|wheat-soft|rust-soft|surface)[^)]*\)|transparent|none|inherit)$/;

function convertirRegla({ selector, cuerpo }) {
  if (selector.includes('data-mode') || EXCLUIDOS.test(selector)) return [];
  const salida = [];
  let fondoCambiado = false;
  let fondoQueBloqueaTexto = false;
  for (const [prop, valor] of declaraciones(cuerpo)) {
    if (prop === 'background' || prop === 'background-color') {
      if (/url\(/.test(valor)) { fondoQueBloqueaTexto = true; continue; }
      const grads = gradientes(valor);
      if (grads.length) {
        const nuevos = grads.map((g) => reemplazarColores(g, (c) => superficieOscura(c, true)));
        if (nuevos.some(Boolean)) {
          salida.push(`background-image: ${grads.map((g, k) => nuevos[k] || g).join(', ')}`);
          fondoCambiado = true;
        }
        const resto = grads.reduce((t, g) => t.replace(g, ''), valor);
        const base = resto.match(RE_COLOR)?.map(leerColor).find(Boolean);
        const baseOscura = base && superficieOscura(base);
        if (baseOscura) salida.push(`background-color: ${baseOscura}`);
        if (!fondoCambiado && !baseOscura && grads.length) fondoQueBloqueaTexto = true;
      } else {
        const nuevo = reemplazarColores(valor, superficieOscura);
        if (nuevo) { salida.push(`background-color: ${nuevo}`); fondoCambiado = true; }
        else if (!FONDO_NEUTRO.test(valor)) fondoQueBloqueaTexto = true;
      }
    } else if (/^border(?:-(?:top|right|bottom|left))?(?:-color)?$/.test(prop)) {
      const lado = prop.match(/^border-(top|right|bottom|left)/)?.[1];
      const colores = valor.match(RE_COLOR) || [];
      const nuevos = colores.map((c) => { const color = leerColor(c); return color && bordeOscuro(color); });
      if (nuevos.length === 1 && nuevos[0]) salida.push(`${lado ? `border-${lado}` : 'border'}-color: ${nuevos[0]}`);
    }
  }
  for (const [prop, valor] of declaraciones(cuerpo)) {
    if (prop !== 'color' || (fondoQueBloqueaTexto && !fondoCambiado)) continue;
    const color = leerColor(valor);
    const claro = color && textoClaro(color);
    if (claro) salida.push(`color: ${claro}`);
  }
  return salida;
}

function prefijar(selector) {
  return selector.split(/,(?![^()]*\))/).map((s) => s.trim()).filter(Boolean).map((s) => {
    if (s.startsWith(':root') || s === 'html') return null;
    return s === 'body' ? '[data-mode="oscuro"] body' : `[data-mode="oscuro"] ${s}`;
  }).filter(Boolean).join(', ');
}

export function generarCapa(css) {
  const inicio = css.indexOf(INICIO);
  const fuente = inicio >= 0 ? css.slice(0, inicio) : css;
  const lineas = [];
  let mediaActual = null;
  for (const regla of leerReglas(fuente)) {
    const props = convertirRegla(regla);
    const selector = props.length && prefijar(regla.selector);
    if (!selector) continue;
    if (regla.media !== mediaActual) {
      if (mediaActual) lineas.push('}');
      if (regla.media) lineas.push(`${regla.media} {`);
      mediaActual = regla.media;
    }
    lineas.push(`${regla.media ? '  ' : ''}${selector} { ${props.join('; ')}; }`);
  }
  if (mediaActual) lineas.push('}');
  return `${INICIO}\n${lineas.join('\n')}\n${FIN}\n`;
}

export function aplicarCapa(css) {
  const capa = generarCapa(css);
  const inicio = css.indexOf(INICIO);
  if (inicio < 0) return `${css.replace(/\s*$/, '\n\n')}${capa}`;
  const fin = css.indexOf(FIN, inicio) + FIN.length;
  return `${css.slice(0, inicio)}${capa}${css.slice(fin).replace(/^\r?\n/, '')}`;
}

async function principal(argv) {
  const original = await readFile(RUTA_ESTILOS, 'utf8');
  const crlf = original.includes('\r\n');
  const css = original.replace(/\r\n/g, '\n');
  const nuevo = aplicarCapa(css);
  if (argv.includes('--check')) {
    if (nuevo !== css) {
      console.error('La capa del modo oscuro está desactualizada: ejecuta node scripts/tema-oscuro.mjs');
      process.exit(1);
    }
    return;
  }
  await writeFile(RUTA_ESTILOS, crlf ? nuevo.replace(/\n/g, '\r\n') : nuevo);
  console.log(`Capa del modo oscuro: ${(generarCapa(css).match(/\n/g) || []).length - 1} líneas.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  principal(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });
}
