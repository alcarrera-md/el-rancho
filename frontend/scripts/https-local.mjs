// App instalable por HTTPS local (P8.3.1).
//
// El celular solo puede instalar la PWA y abrirla sin red desde un origen
// seguro. Este script:
//   1. crea una autoridad certificadora (CA) propia de ESTE equipo, limitada
//      por "name constraints" a direcciones privadas y localhost, y un
//      certificado de servidor para las IP de la laptop (incluida la fija del
//      Mobile Hotspot, 192.168.137.1);
//   2. sirve el build de producción (dist) por HTTPS con fallback SPA y proxy
//      /api y /uploads al backend local;
//   3. publica por HTTP, en otro puerto, SOLO el certificado público de la CA
//      para instalarlo una vez en cada celular.
// Todo vive en archivos (no toca el almacén de certificados de Windows).
import { generateKeyPairSync, X509Certificate, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import forge from 'node-forge';

export const IP_HOTSPOT = '192.168.137.1';
const DIAS_SERVIDOR = 397;
const DIAS_RENOVAR = 30;
const RANGOS_PERMITIDOS = [
  ['10.0.0.0', '255.0.0.0'],
  ['172.16.0.0', '255.240.0.0'],
  ['192.168.0.0', '255.255.0.0'],
  ['127.0.0.0', '255.0.0.0'],
];

const { asn1, pki } = forge;

function bytesIp(ip) {
  return String.fromCharCode(...ip.split('.').map(Number));
}

// NameConstraints (RFC 5280 §4.2.1.10): solo IP privadas y "localhost".
function extensionRestriccionNombres() {
  const subarbol = (nombre) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [nombre]);
  const permitidos = [
    ...RANGOS_PERMITIDOS.map(([base, mascara]) => subarbol(asn1.create(asn1.Class.CONTEXT_SPECIFIC, 7, false, bytesIp(base) + bytesIp(mascara)))),
    subarbol(asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, 'localhost')),
  ];
  const valor = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, permitidos),
  ]);
  return { id: '2.5.29.30', critical: true, value: asn1.toDer(valor).getBytes() };
}

function nuevaClave() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const clave = pki.privateKeyFromPem(pem);
  return { pem, clave, publica: pki.setRsaPublicKey(clave.n, clave.e) };
}

function numeroSerie() {
  // Positivo (primer bit en 0) y único.
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f;
  return bytes.toString('hex');
}

function sumarDias(fecha, dias) {
  const copia = new Date(fecha);
  copia.setUTCDate(copia.getUTCDate() + dias);
  return copia;
}

export function crearAutoridad(ahora = new Date()) {
  const { pem, clave, publica } = nuevaClave();
  const cert = pki.createCertificate();
  cert.publicKey = publica;
  cert.serialNumber = numeroSerie();
  cert.validity.notBefore = sumarDias(ahora, -1);
  cert.validity.notAfter = sumarDias(ahora, 3650);
  const nombre = [{ name: 'commonName', value: 'El Rancho - CA local de este equipo' }, { name: 'organizationName', value: 'El Rancho (uso local)' }];
  cert.setSubject(nombre);
  cert.setIssuer(nombre);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
    extensionRestriccionNombres(),
  ]);
  cert.sign(clave, forge.md.sha256.create());
  return { certPem: pki.certificateToPem(cert), clavePem: pem };
}

export function crearCertificadoServidor({ caCertPem, caClavePem, ips, ahora = new Date() }) {
  const ca = pki.certificateFromPem(caCertPem);
  const caClave = pki.privateKeyFromPem(caClavePem);
  const { pem, publica } = nuevaClave();
  const cert = pki.createCertificate();
  cert.publicKey = publica;
  cert.serialNumber = numeroSerie();
  cert.validity.notBefore = sumarDias(ahora, -1);
  cert.validity.notAfter = sumarDias(ahora, DIAS_SERVIDOR);
  cert.setSubject([{ name: 'commonName', value: 'El Rancho en esta laptop' }]);
  cert.setIssuer(ca.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: ca.generateSubjectKeyIdentifier().getBytes() },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip }))] },
  ]);
  cert.sign(caClave, forge.md.sha256.create());
  return { certPem: pki.certificateToPem(cert), clavePem: pem };
}

export function ipsRequeridas(ipsDetectadas = []) {
  return [...new Set([IP_HOTSPOT, '127.0.0.1', ...ipsDetectadas.filter((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip))])];
}

/** Crea la CA (una sola vez) y renueva el certificado del servidor si falta, vence o no cubre una IP. */
export async function asegurarCertificados({ dir, ips = [], ahora = new Date() }) {
  await mkdir(dir, { recursive: true });
  const rutas = {
    caCert: join(dir, 'el-rancho-ca.pem'),
    caClave: join(dir, 'el-rancho-ca.key'),
    cert: join(dir, 'servidor.pem'),
    clave: join(dir, 'servidor.key'),
  };
  let caNueva = false;
  if (!existsSync(rutas.caCert) || !existsSync(rutas.caClave)) {
    const ca = crearAutoridad(ahora);
    await writeFile(rutas.caClave, ca.clavePem, { mode: 0o600 });
    await writeFile(rutas.caCert, ca.certPem);
    caNueva = true;
  }
  const caCertPem = await readFile(rutas.caCert, 'utf8');
  const requeridas = ipsRequeridas(ips);
  let renovar = caNueva || !existsSync(rutas.cert) || !existsSync(rutas.clave);
  if (!renovar) {
    const actual = new X509Certificate(await readFile(rutas.cert, 'utf8'));
    const cubiertas = (actual.subjectAltName || '').split(', ').filter((n) => n.startsWith('IP Address:')).map((n) => n.slice('IP Address:'.length));
    const vence = new Date(actual.validTo);
    renovar = requeridas.some((ip) => !cubiertas.includes(ip))
      || vence.getTime() - ahora.getTime() < DIAS_RENOVAR * 86_400_000
      || !actual.checkIssued(new X509Certificate(caCertPem));
  }
  if (renovar) {
    const servidor = crearCertificadoServidor({ caCertPem, caClavePem: await readFile(rutas.caClave, 'utf8'), ips: requeridas, ahora });
    await writeFile(rutas.clave, servidor.clavePem, { mode: 0o600 });
    await writeFile(rutas.cert, servidor.certPem);
  }
  const ca = new X509Certificate(caCertPem);
  return { ...rutas, caNueva, renovado: renovar, ips: requeridas, huellaCa: ca.fingerprint256 };
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function enviarArchivo(res, ruta, metodo) {
  const nombre = ruta.split(sep).pop();
  const esShell = nombre === 'index.html' || nombre === 'sw.js' || nombre === 'manifest.webmanifest';
  res.writeHead(200, {
    'Content-Type': TIPOS[extname(ruta).toLowerCase()] || 'application/octet-stream',
    // El shell se revalida siempre (el Service Worker gestiona su propia
    // caché); los assets con hash son inmutables.
    'Cache-Control': esShell ? 'no-cache' : ruta.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (metodo === 'HEAD') return res.end();
  createReadStream(ruta).pipe(res);
}

function proxy(req, res, puertoBackend) {
  const salida = http.request({
    host: '127.0.0.1', port: puertoBackend, method: req.method, path: req.url,
    headers: { ...req.headers, host: `127.0.0.1:${puertoBackend}`, 'x-forwarded-proto': 'https' },
  }, (respuesta) => {
    res.writeHead(respuesta.statusCode || 502, respuesta.headers);
    respuesta.pipe(res);
  });
  salida.on('error', () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'BACKEND_NO_DISPONIBLE', message: 'El backend de El Rancho no respondió.' } }));
  });
  req.pipe(salida);
}

export function crearManejador({ dist, puertoBackend = 3000 }) {
  const raiz = resolve(dist);
  const indice = join(raiz, 'index.html');
  return (req, res) => {
    let ruta;
    try { ruta = decodeURIComponent(new URL(req.url, 'https://local').pathname); } catch { res.writeHead(400); return res.end(); }
    if (/^\/(api|uploads)(\/|$)/.test(ruta)) return proxy(req, res, puertoBackend);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    const archivo = resolve(raiz, `.${ruta}`);
    if (archivo !== raiz && !archivo.startsWith(raiz + sep)) { res.writeHead(403); return res.end(); }
    if (existsSync(archivo) && statSync(archivo).isFile()) return enviarArchivo(res, archivo, req.method);
    // Fallback SPA: cualquier ruta de la app sin extensión devuelve index.html.
    if (!extname(ruta)) return enviarArchivo(res, indice, req.method);
    res.writeHead(404); return res.end();
  };
}

function paginaCa(puertoApp) {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>El Rancho - certificado local</title>
<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:1.5rem auto;padding:0 1rem;line-height:1.5">
<h1>Instalar El Rancho en este celular</h1>
<p>Esto se hace <strong>una sola vez</strong> por celular.</p>
<ol>
<li><a href="/el-rancho-ca.crt">Descarga el certificado de El Rancho</a>.</li>
<li>En Android: <em>Ajustes → Seguridad → Más ajustes de seguridad → Encriptación y credenciales → Instalar un certificado → Certificado de CA</em> y elige el archivo descargado. Android avisará que “la red podría estar supervisada”: es normal para un certificado propio.</li>
<li>Abre <strong>https://${IP_HOTSPOT}:${puertoApp}</strong> (o la dirección que muestra la laptop), inicia sesión y usa <em>Instalar app</em> en el menú de Chrome.</li>
</ol>
<p>Este certificado solo sirve para direcciones de redes privadas; no afecta la navegación en Internet.</p>
</body></html>`;
}

export function crearManejadorCa({ caDerPath, puertoApp }) {
  return async (req, res) => {
    const ruta = new URL(req.url, 'http://local').pathname;
    if (ruta === '/el-rancho-ca.crt') {
      res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="el-rancho-ca.crt"' });
      return res.end(await readFile(caDerPath));
    }
    if (ruta === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(paginaCa(puertoApp));
    }
    res.writeHead(404); return res.end();
  };
}

async function servir({ dir, dist, puerto, puertoCa, puertoBackend }) {
  const rutas = {
    caCert: join(dir, 'el-rancho-ca.pem'), cert: join(dir, 'servidor.pem'), clave: join(dir, 'servidor.key'),
  };
  const caDer = join(dir, 'el-rancho-ca.crt');
  const caPem = await readFile(rutas.caCert, 'utf8');
  // Android instala CA en formato DER (.crt).
  await writeFile(caDer, Buffer.from(forge.asn1.toDer(pki.certificateToAsn1(pki.certificateFromPem(caPem))).getBytes(), 'binary'));
  const servidor = https.createServer({ key: await readFile(rutas.clave), cert: await readFile(rutas.cert) }, crearManejador({ dist, puertoBackend }));
  await new Promise((ok, error) => { servidor.once('error', error); servidor.listen(puerto, '0.0.0.0', ok); });
  if (puertoCa) {
    const ca = http.createServer(crearManejadorCa({ caDerPath: caDer, puertoApp: puerto }));
    await new Promise((ok, error) => { ca.once('error', error); ca.listen(puertoCa, '0.0.0.0', ok); });
  }
  console.log(`El Rancho HTTPS local escuchando en ${puerto}${puertoCa ? `; certificado en http :${puertoCa}` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [comando, ...resto] = process.argv.slice(2);
  const opcion = (nombre, porDefecto = null) => { const i = resto.indexOf(nombre); return i >= 0 ? resto[i + 1] : porDefecto; };
  const dir = opcion('--dir');
  if (!dir) { console.error('Falta --dir'); process.exit(2); }
  if (comando === 'certificados') {
    const ips = (opcion('--ips', '') || '').split(',').map((ip) => ip.trim()).filter(Boolean);
    const resultado = await asegurarCertificados({ dir, ips });
    process.stdout.write(JSON.stringify({ caNueva: resultado.caNueva, renovado: resultado.renovado, ips: resultado.ips, huellaCa: resultado.huellaCa }));
  } else if (comando === 'servir') {
    const dist = opcion('--dist', fileURLToPath(new URL('../dist/', import.meta.url)));
    await servir({ dir, dist, puerto: Number(opcion('--puerto', 5443)), puertoCa: Number(opcion('--puerto-ca', 0)) || null, puertoBackend: Number(opcion('--backend', 3000)) });
  } else {
    console.error('Uso: node https-local.mjs certificados|servir --dir <carpeta> [...]');
    process.exit(2);
  }
}
