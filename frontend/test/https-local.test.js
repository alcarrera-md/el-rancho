import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  asegurarCertificados, crearCertificadoServidor, crearManejador, crearManejadorCa, IP_HOTSPOT, ipsRequeridas,
} from '../scripts/https-local.mjs';

async function directorio() {
  return mkdtemp(join(tmpdir(), 'rancho-https-'));
}

function pedir(opciones) {
  return new Promise((resolve) => {
    const cliente = opciones.protocolo === 'http' ? http : https;
    cliente.get(opciones, (respuesta) => {
      let cuerpo = '';
      respuesta.on('data', (trozo) => { cuerpo += trozo; });
      respuesta.on('end', () => resolve({ status: respuesta.statusCode, cuerpo, headers: respuesta.headers }));
    }).on('error', (error) => resolve({ error: error.message }));
  });
}

async function escuchar(servidor) {
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  return servidor.address().port;
}

test('certificados: CA limitada a redes privadas, servidor con la IP fija del hotspot y renovación solo cuando hace falta', async () => {
  const dir = await directorio();
  const primera = await asegurarCertificados({ dir, ips: ['10.11.24.110'] });
  assert.equal(primera.caNueva, true);
  assert.deepEqual(primera.ips, [IP_HOTSPOT, '127.0.0.1', '10.11.24.110']);
  const servidor = new X509Certificate(await readFile(primera.cert, 'utf8'));
  const ca = new X509Certificate(await readFile(primera.caCert, 'utf8'));
  assert.ok(servidor.checkIssued(ca));
  assert.match(servidor.subjectAltName, /IP Address:192\.168\.137\.1/);
  assert.equal(ca.ca, true);
  // Sin cambios de red no se regenera nada.
  const segunda = await asegurarCertificados({ dir, ips: ['10.11.24.110'] });
  assert.deepEqual([segunda.caNueva, segunda.renovado], [false, false]);
  // Nueva red: se renueva solo el certificado del servidor; la CA (instalada en los celulares) se conserva.
  const tercera = await asegurarCertificados({ dir, ips: ['192.168.1.40'] });
  assert.deepEqual([tercera.caNueva, tercera.renovado], [false, true]);
  assert.equal(tercera.huellaCa, primera.huellaCa);
  assert.deepEqual(ipsRequeridas(['nada', '10.0.0.5']), [IP_HOTSPOT, '127.0.0.1', '10.0.0.5']);
});

test('TLS real: el celular con la CA confía en El Rancho; la CA no puede avalar una IP pública', async () => {
  const dir = await directorio();
  const rutas = await asegurarCertificados({ dir, ips: [] });
  const dist = join(dir, 'dist');
  await mkdir(dist);
  await writeFile(join(dist, 'index.html'), '<title>El Rancho</title>');
  const ca = await readFile(rutas.caCert);
  const probar = async (cert, key) => {
    const servidor = https.createServer({ cert, key }, crearManejador({ dist }));
    const puerto = await escuchar(servidor);
    const r = await pedir({ host: '127.0.0.1', port: puerto, path: '/animales', ca });
    servidor.close();
    return r;
  };
  const valido = await probar(await readFile(rutas.cert), await readFile(rutas.clave));
  assert.equal(valido.status, 200);
  assert.match(valido.cuerpo, /El Rancho/);
  const malicioso = crearCertificadoServidor({ caCertPem: await readFile(rutas.caCert, 'utf8'), caClavePem: await readFile(rutas.caClave, 'utf8'), ips: ['127.0.0.1', '8.8.8.8'] });
  const rechazo = await probar(malicioso.certPem, malicioso.clavePem);
  assert.match(rechazo.error || '', /permitted subtree violation/);
});

test('servidor: SPA, cabeceras de caché, traversal bloqueado y proxy /api con backend caído', async () => {
  const dir = await directorio();
  const dist = join(dir, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<title>El Rancho</title>');
  await writeFile(join(dist, 'sw.js'), 'self');
  await writeFile(join(dist, 'assets', 'app-1.js'), 'console.log(1)');
  await writeFile(join(dir, 'secreto.txt'), 'no');
  const servidor = http.createServer(crearManejador({ dist, puertoBackend: 1 }));
  const port = await escuchar(servidor);
  const get = (path) => pedir({ protocolo: 'http', host: '127.0.0.1', port, path });
  try {
    assert.match((await get('/corrales/3')).cuerpo, /El Rancho/, 'fallback SPA');
    assert.equal((await get('/sw.js')).headers['cache-control'], 'no-cache');
    assert.match((await get('/assets/app-1.js')).headers['cache-control'], /immutable/);
    assert.equal((await get('/assets/app-1.js')).headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal((await get('/..%2Fsecreto.txt')).status, 403);
    assert.equal((await get('/no-existe.png')).status, 404);
    const api = await get('/api/health');
    assert.equal(api.status, 502);
    assert.match(api.cuerpo, /BACKEND_NO_DISPONIBLE/);
  } finally {
    servidor.close();
  }
});

test('descarga del certificado: solo el certificado público y una página de instrucciones', async () => {
  const dir = await directorio();
  const der = join(dir, 'el-rancho-ca.crt');
  await writeFile(der, Buffer.from([0x30, 0x82]));
  const servidor = http.createServer(crearManejadorCa({ caDerPath: der, puertoApp: 5443 }));
  const port = await escuchar(servidor);
  const get = (path) => pedir({ protocolo: 'http', host: '127.0.0.1', port, path });
  try {
    const cert = await get('/el-rancho-ca.crt');
    assert.equal(cert.headers['content-type'], 'application/x-x509-ca-cert');
    const pagina = await get('/');
    assert.match(pagina.cuerpo, /una sola vez/);
    assert.match(pagina.cuerpo, /https:\/\/192\.168\.137\.1:5443/);
    assert.equal((await get('/el-rancho-ca.key')).status, 404, 'la clave privada nunca se publica');
  } finally {
    servidor.close();
  }
});
