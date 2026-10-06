// Demo pública temporal por Cloudflare Quick Tunnel.
//
// Lo usa scripts/iniciar-el-rancho.ps1 (opción "Demo publica por Internet"):
//   url <log>            extrae la URL https://*.trycloudflare.com del log de cloudflared
//   error <log>          traduce un fallo conocido de cloudflared a un mensaje claro
//   verificar <url>      prueba la URL pública desde esta PC antes de anunciarla
//   revisar-dist <dir>   avisa si el build contiene direcciones locales o privadas
//
// La verificación resuelve el subdominio nuevo con DNS públicos: Windows puede
// guardar en caché un "no existe" si se consulta antes de que Cloudflare lo
// publique, y el celular no comparte esa caché.
import { readFile, readdir } from 'node:fs/promises';
import https from 'node:https';
import dns from 'node:dns';
import { join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RE_URL_TUNEL = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i;

export function extraerUrlTunel(texto) {
  const coincidencia = String(texto || '').match(RE_URL_TUNEL);
  return coincidencia ? coincidencia[0].toLowerCase() : null;
}

const ERRORES_TUNEL = [
  [/429 Too Many Requests|too many requests|rate limit/i, 'Cloudflare rechazo crear el tunel temporal por exceso de solicitudes. Espera uno o dos minutos y vuelve a intentar.'],
  // La causa de red va antes que el fallo genérico: "failed to request quick
  // Tunnel ... no such host" significa que no hay Internet o DNS.
  [/no such host|server misbehaving|dial tcp|i\/o timeout|network is unreachable|connectex/i, 'cloudflared no pudo contactar a Cloudflare. Revisa que la laptop tenga Internet y que la red no bloquee Cloudflare.'],
  [/failed to unmarshal quick Tunnel|failed to request quick Tunnel/i, 'Cloudflare no pudo entregar un tunel temporal en este momento. Vuelve a intentar en un minuto.'],
  [/config\.ya?ml|cannot determine default configuration path|tunnel credentials/i, 'Hay una configuracion de Cloudflare Tunnel permanente en este usuario que interfiere con el tunel temporal (~\\.cloudflared\\config.yml).'],
];

export function errorTunel(texto) {
  const contenido = String(texto || '');
  const conocido = ERRORES_TUNEL.find(([patron]) => patron.test(contenido));
  return conocido ? conocido[1] : null;
}

// Búsqueda DNS con resolutores públicos y respaldo al resolutor del sistema.
function crearBusquedaPublica() {
  const resolutor = new dns.promises.Resolver({ timeout: 3000, tries: 2 });
  resolutor.setServers(['1.1.1.1', '1.0.0.1', '8.8.8.8']);
  return (host, opciones, callback) => {
    resolutor.resolve4(host)
      .then((direcciones) => {
        if (!direcciones.length) throw new Error('sin registros');
        if (opciones?.all) callback(null, direcciones.map((address) => ({ address, family: 4 })));
        else callback(null, direcciones[0], 4);
      })
      .catch(() => dns.lookup(host, opciones, callback));
  };
}

export function peticionHttps(url, { lookup = crearBusquedaPublica(), timeoutMs = 10000, ca } = {}) {
  return new Promise((resolve) => {
    const solicitud = https.get(url, { lookup, timeout: timeoutMs, ca, headers: { 'User-Agent': 'ElRancho-DemoCheck/1.0', Accept: '*/*' } }, (respuesta) => {
      let cuerpo = '';
      respuesta.setEncoding('utf8');
      respuesta.on('data', (trozo) => { if (cuerpo.length < 200_000) cuerpo += trozo; });
      respuesta.on('end', () => resolve({ status: respuesta.statusCode, headers: respuesta.headers, cuerpo }));
    });
    solicitud.on('timeout', () => solicitud.destroy(new Error('tiempo de espera agotado')));
    solicitud.on('error', (error) => resolve({ error: error.code || error.message }));
  });
}

// Cada comprobación describe qué demuestra. La app no está "lista" hasta que
// las obligatorias pasan a través de la URL pública.
export const COMPROBACIONES = [
  {
    clave: 'frontend', nombre: 'Aplicacion publica (HTTPS 200)', ruta: '/', obligatoria: true,
    valida: (r) => r.status === 200 && /<div id="root"><\/div>|<div id="root">/.test(r.cuerpo),
    fallo: 'La URL publica no entrega la aplicacion de El Rancho.',
  },
  {
    clave: 'login', nombre: 'Pantalla de inicio de sesion (ruta /login)', ruta: '/login', obligatoria: true,
    valida: (r) => r.status === 200 && /El Rancho/i.test(r.cuerpo),
    fallo: 'La pantalla de inicio de sesion no carga por la URL publica.',
  },
  {
    clave: 'api', nombre: 'Backend por la misma URL (/api/health)', ruta: '/api/health', obligatoria: true,
    valida: (r) => r.status === 200 && /"status"\s*:\s*"ok"/.test(r.cuerpo),
    fallo: 'La URL publica existe pero /api/health no responde: el frontend no llega al backend.',
  },
  {
    clave: 'sesion', nombre: 'API protegida responde sin sesion (401)', ruta: '/api/auth/me', obligatoria: true,
    valida: (r) => r.status === 401 && /^application\/json/i.test(String(r.headers?.['content-type'] || '')),
    fallo: 'La API protegida no responde como El Rancho a traves de la URL publica.',
  },
  {
    clave: 'pwa', nombre: 'Manifest de la app (HTTPS)', ruta: '/manifest.webmanifest', obligatoria: false,
    valida: (r) => r.status === 200 && /"start_url"\s*:\s*"\/"/.test(r.cuerpo),
    fallo: 'El manifest no se pudo leer (la instalacion como app es opcional para la demo).',
  },
];

function esperar(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Reintenta hasta que todas las comprobaciones obligatorias pasan o se agota
// el tiempo: un Quick Tunnel recién creado tarda unos segundos en propagarse.
export async function verificarDemo(urlBase, { timeoutMs = 90_000, esperaMs = 3000, peticion = peticionHttps, alProgreso = () => {} } = {}) {
  const base = new URL(urlBase);
  if (base.protocol !== 'https:') return { ok: false, mensaje: 'La URL publica debe ser HTTPS.', comprobaciones: [] };
  const limite = Date.now() + timeoutMs;
  let intento = 0;
  let resultados = [];
  do {
    intento += 1;
    resultados = [];
    for (const comprobacion of COMPROBACIONES) {
      const respuesta = await peticion(new URL(comprobacion.ruta, base).toString());
      const ok = !respuesta.error && comprobacion.valida(respuesta);
      resultados.push({ ...comprobacion, ok, detalle: respuesta.error ? `sin respuesta (${respuesta.error})` : `HTTP ${respuesta.status}` });
      if (!ok && comprobacion.obligatoria) break;
    }
    const pendiente = resultados.find((r) => !r.ok && r.obligatoria);
    if (!pendiente) {
      return { ok: true, intentos: intento, comprobaciones: resultados };
    }
    alProgreso({ intento, pendiente });
    if (Date.now() + esperaMs >= limite) break;
    await esperar(esperaMs);
  } while (Date.now() < limite);
  const pendiente = resultados.find((r) => !r.ok && r.obligatoria);
  return { ok: false, intentos: intento, mensaje: `${pendiente.fallo} (${pendiente.detalle})`, comprobaciones: resultados };
}

// Busca en el build direcciones que el celular no podría abrir: localhost con
// puerto (p. ej. una API en http://localhost:3000) o cualquier IP privada.
// "http://localhost" sin puerto no se marca: React Router lo usa como base
// interna para interpretar rutas y nunca hace peticiones a esa dirección.
const RE_DIRECCION_LOCAL = /https?:\/\/(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+|(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?)/g;

export async function revisarDist(dir) {
  const hallazgos = [];
  async function recorrer(carpeta) {
    for (const entrada of await readdir(carpeta, { withFileTypes: true })) {
      const ruta = join(carpeta, entrada.name);
      if (entrada.isDirectory()) await recorrer(ruta);
      else if (['.js', '.html', '.webmanifest', '.json', '.css'].includes(extname(entrada.name)) && entrada.name !== 'bundle-analysis.json') {
        const contenido = await readFile(ruta, 'utf8');
        for (const direccion of new Set(contenido.match(RE_DIRECCION_LOCAL) || [])) hallazgos.push({ archivo: ruta, direccion });
      }
    }
  }
  await recorrer(dir);
  return hallazgos;
}

async function principal(argv) {
  const [comando, valor, ...resto] = argv;
  if (comando === 'url') {
    const url = extraerUrlTunel(await readFile(valor, 'utf8').catch(() => ''));
    if (!url) process.exit(1);
    process.stdout.write(url);
    return;
  }
  if (comando === 'error') {
    const mensaje = errorTunel(await readFile(valor, 'utf8').catch(() => ''));
    if (mensaje) process.stdout.write(mensaje);
    return;
  }
  if (comando === 'revisar-dist') {
    const hallazgos = await revisarDist(valor);
    for (const h of hallazgos) console.log(`AVISO: ${h.direccion} en ${h.archivo}`);
    process.exit(hallazgos.length ? 2 : 0);
  }
  if (comando === 'verificar') {
    const indice = resto.indexOf('--timeout');
    const timeoutMs = indice >= 0 ? Number(resto[indice + 1]) * 1000 : 90_000;
    const resultado = await verificarDemo(valor, {
      timeoutMs,
      alProgreso: ({ intento, pendiente }) => console.log(`  Intento ${intento}: ${pendiente.nombre} todavia no responde (${pendiente.detalle}). Reintentando...`),
    });
    for (const r of resultado.comprobaciones) {
      console.log(`  ${r.nombre.padEnd(46, '.')} ${r.ok ? 'OK' : (r.obligatoria ? 'FALLO' : 'AVISO')}`);
    }
    if (!resultado.ok) {
      console.log(`ERROR: ${resultado.mensaje}`);
      process.exit(1);
    }
    return;
  }
  console.error('Uso: node scripts/demo-publica.mjs <url|error|verificar|revisar-dist> <valor>');
  process.exit(64);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  principal(process.argv.slice(2)).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

export const RUTA_SCRIPT = fileURLToPath(import.meta.url);
