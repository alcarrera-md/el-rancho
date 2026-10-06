import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  analizarFirewall, clasificarInterfaces, decidirDireccion, esIpPrivada, perfilDesdeCategoria, responde,
} from '../scripts/lan-launcher.mjs';

const ejecutar = promisify(execFile);

// Interfaces tal como las entrega Get-RanchoInterfaces (API .NET de Windows).
const wifi = { nombre: 'Wi-Fi', descripcion: 'Intel(R) Wi-Fi 6 AX201 160MHz', tipo: 'Wireless80211', estado: 'Up', ipv4: [{ ip: '192.168.1.40', prefijo: 24 }], gateways: ['192.168.1.1'], metrica: 50, categoria: 'Private' };
const hotspot = { nombre: 'Conexión de área local* 2', descripcion: 'Microsoft Wi-Fi Direct Virtual Adapter #2', tipo: 'Wireless80211', estado: 'Up', ipv4: [{ ip: '192.168.137.1', prefijo: 24 }], gateways: [], metrica: 25, categoria: 'Public', ics_privada: true, clientes: 1 };
const hotspotApagado = { ...hotspot, nombre: 'Conexión de área local* 1', descripcion: 'Microsoft Wi-Fi Direct Virtual Adapter', estado: 'Down', ipv4: [{ ip: '169.254.132.22', prefijo: 16 }], ics_privada: false };
const wifiDirectApipa = { ...hotspot, nombre: 'Conexión de área local* 3', ipv4: [{ ip: '169.254.10.5', prefijo: 16 }], ics_privada: false };
const ethernet = { nombre: 'Ethernet', descripcion: 'Intel(R) Ethernet Connection I219-V', tipo: 'Ethernet', estado: 'Up', ipv4: [{ ip: '10.0.0.15', prefijo: 24 }], gateways: ['10.0.0.1'], metrica: 5, categoria: 'Private' };
const ethernetDesconectado = { ...ethernet, estado: 'Down' };
const loopback = { nombre: 'Loopback Pseudo-Interface 1', descripcion: 'Software Loopback Interface 1', tipo: 'Loopback', estado: 'Up', ipv4: [{ ip: '127.0.0.1', prefijo: 8 }], gateways: [] };
const virtuales = [
  { nombre: 'vEthernet (Default Switch)', descripcion: 'Hyper-V Virtual Ethernet Adapter', tipo: 'Ethernet', estado: 'Up', ipv4: [{ ip: '172.25.160.1', prefijo: 20 }], gateways: [] },
  { nombre: 'vEthernet (WSL)', descripcion: 'Hyper-V Virtual Ethernet Adapter #2', tipo: 'Ethernet', estado: 'Up', ipv4: [{ ip: '172.30.64.1', prefijo: 20 }], gateways: [] },
  { nombre: 'DockerNAT', descripcion: 'Docker Desktop network', tipo: 'Ethernet', estado: 'Up', ipv4: [{ ip: '10.0.75.1', prefijo: 24 }], gateways: [] },
  { nombre: 'VirtualBox Host-Only Network', descripcion: 'VirtualBox Host-Only Ethernet Adapter', tipo: 'Ethernet', estado: 'Up', ipv4: [{ ip: '192.168.56.1', prefijo: 24 }], gateways: [] },
  { nombre: 'Oficina VPN', descripcion: 'Fortinet SSL VPN Virtual Ethernet Adapter', tipo: 'Ethernet', estado: 'Up', ipv4: [{ ip: '10.212.134.2', prefijo: 32 }], gateways: ['10.212.134.1'] },
  { nombre: 'Tailscale', descripcion: 'Tailscale Tunnel', tipo: 'Unknown', estado: 'Up', ipv4: [{ ip: '100.101.1.2', prefijo: 32 }], gateways: [] },
  { nombre: 'Conexión de red Bluetooth', descripcion: 'Bluetooth Device (Personal Area Network)', tipo: 'Ethernet', estado: 'Up', ipv4: [{ ip: '192.168.44.2', prefijo: 24 }], gateways: [] },
];

const todas = (cands) => new Set(cands.map((c) => c.ip));

test('escenario A: con Mobile Hotspot activo se elige la IP del hotspot, no la del Wi-Fi físico', () => {
  const red = clasificarInterfaces([wifi, hotspot, hotspotApagado, loopback]);
  assert.deepEqual(red.candidatos.map((c) => [c.ip, c.clase]), [['192.168.137.1', 'hotspot'], ['192.168.1.40', 'wifi']]);
  const decision = decidirDireccion(red, todas(red.candidatos));
  assert.equal(decision.estado, 'ok');
  assert.equal(decision.modo, 'Celular por Mobile Hotspot');
  assert.equal(decision.elegido.url, 'http://192.168.137.1:5173');
  assert.equal(decision.elegido.clientes_hotspot, 1);
  assert.deepEqual(decision.alternativas.map((c) => c.url), ['http://192.168.1.40:5173'], 'el Wi-Fi queda como alternativa visible');
});

test('escenario A bis: el hotspot se reconoce por el adaptador aunque Windows no marque ICS', () => {
  const red = clasificarInterfaces([{ ...hotspot, ics_privada: false, ipv4: [{ ip: '192.168.137.1', prefijo: 24 }] }]);
  assert.equal(red.candidatos[0].clase, 'hotspot');
});

test('escenario B: red Wi-Fi normal', () => {
  const red = clasificarInterfaces([wifi, hotspotApagado, ethernetDesconectado, loopback]);
  const decision = decidirDireccion(red, todas(red.candidatos));
  assert.equal(decision.estado, 'ok');
  assert.equal(decision.modo, 'Red local Wi-Fi');
  assert.equal(decision.elegido.url, 'http://192.168.1.40:5173');
  assert.deepEqual(decision.alternativas, []);
});

test('la laptop conectada como cliente al hotspot de otro equipo usa su Wi-Fi físico, no se confunde con hotspot propio', () => {
  const cliente = { ...wifi, ipv4: [{ ip: '192.168.137.232', prefijo: 24 }], gateways: ['192.168.137.1'] };
  const red = clasificarInterfaces([cliente, hotspotApagado]);
  assert.deepEqual(red.candidatos.map((c) => [c.ip, c.clase]), [['192.168.137.232', 'wifi']]);
});

test('escenario C: con muchas interfaces virtuales solo queda la red real y se explica cada descarte', () => {
  const red = clasificarInterfaces([...virtuales, wifiDirectApipa, hotspotApagado, ethernetDesconectado, loopback, wifi]);
  assert.deepEqual(red.candidatos.map((c) => c.ip), ['192.168.1.40']);
  const motivos = Object.fromEntries(red.ignorados.map((i) => [i.nombre, i.motivo]));
  assert.equal(motivos['vEthernet (WSL)'], 'virtual, VPN o túnel');
  assert.equal(motivos['Oficina VPN'], 'virtual, VPN o túnel');
  assert.equal(motivos.Tailscale, 'virtual, VPN o túnel');
  assert.equal(motivos['Conexión de área local* 3'], 'solo dirección automática 169.254 (sin red real)');
  assert.equal(motivos.Ethernet, 'desconectada');
  assert.equal(motivos['Loopback Pseudo-Interface 1'], 'interfaz interna');
});

test('dos redes igual de plausibles: no se elige en silencio', () => {
  const red = clasificarInterfaces([wifi, ethernet]);
  const decision = decidirDireccion(red, todas(red.candidatos));
  assert.equal(decision.estado, 'ambiguo');
  assert.equal(decision.elegido.ip, '10.0.0.15', 'gana la de menor métrica');
  assert.deepEqual(decision.alternativas.map((c) => c.ip), ['192.168.1.40']);
  assert.match(decision.mensaje, /varias redes/);
});

test('una red local sin gateway (router sin Internet) sigue siendo válida para el celular', () => {
  const sinInternet = { ...wifi, gateways: [] };
  const red = clasificarInterfaces([sinInternet]);
  assert.equal(red.candidatos[0].clase, 'local_sin_gateway');
  assert.equal(decidirDireccion(red, todas(red.candidatos)).modo, 'Red local Wi-Fi sin Internet');
});

test('una IP candidata que no responde no se ofrece como la buena', () => {
  const red = clasificarInterfaces([hotspot, wifi]);
  const decision = decidirDireccion(red, new Set(['192.168.1.40']));
  assert.equal(decision.elegido.ip, '192.168.1.40');
  assert.deepEqual(decision.sin_respuesta.map((c) => c.ip), ['192.168.137.1']);
  const nada = decidirDireccion(red, new Set());
  assert.equal(nada.estado, 'sin_respuesta');
  assert.equal(nada.elegido, null);
});

test('escenario F: sin adaptador LAN válido se informa sin inventar una dirección', () => {
  const red = clasificarInterfaces([...virtuales, hotspotApagado, ethernetDesconectado, loopback]);
  const decision = decidirDireccion(red, new Set());
  assert.equal(decision.estado, 'sin_red');
  assert.equal(decision.elegido, null);
  assert.match(decision.mensaje, /Mobile Hotspot/);
});

test('rangos privados y perfiles de red', () => {
  assert.deepEqual(['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.1', '172.32.0.1', '100.64.0.1', '8.8.8.8'].map(esIpPrivada), [true, true, true, true, false, false, false]);
  assert.equal(perfilDesdeCategoria('Public'), 'public');
  assert.equal(perfilDesdeCategoria('Private'), 'private');
  assert.equal(perfilDesdeCategoria(null), null);
});

const NETSH_ES = `
Nombre de regla:                      El Rancho Frontend LAN
----------------------------------------------------------------------
Habilitada:                           Sí
Dirección:                            Dentro
Perfiles:                             Privada
Protocolo:                            TCP
LocalPort:                            5173
Acción:                               Permitir

Nombre de regla:                      Microsoft Store
----------------------------------------------------------------------
Habilitada:                           Sí
Dirección:                            Dentro
Perfiles:                             Dominio,Privada,Pública
Protocolo:                            Cualquiera
LocalPort:                            Cualquiera
Acción:                               Permitir

Nombre de regla:                      Node.js JavaScript Runtime
----------------------------------------------------------------------
Habilitada:                           Sí
Dirección:                            Dentro
Perfiles:                             Pública
Protocolo:                            TCP
LocalPort:                            Cualquiera
Programa:                             C:\\program files\\nodejs\\node.exe
Acción:                               Bloquear
`;

test('firewall (netsh en español): permiso por puerto, bloqueo de node.exe con prioridad y reglas ajenas ignoradas', () => {
  assert.deepEqual(analizarFirewall(NETSH_ES, { perfil: 'private' }), { legible: true, permitido: true, reglas: ['El Rancho Frontend LAN'], bloqueos: [] });
  const publico = analizarFirewall(NETSH_ES, { perfil: 'public' });
  assert.equal(publico.permitido, false);
  assert.deepEqual(publico.bloqueos, ['Node.js JavaScript Runtime']);
  assert.equal(analizarFirewall(NETSH_ES, { perfil: 'private', puerto: 3000 }).permitido, false, 'la regla es solo para 5173');
  assert.equal(analizarFirewall('', { perfil: 'private' }).legible, false);
});

test('firewall (netsh en inglés) y rangos de puertos', () => {
  const texto = 'Rule Name:   Dev servers\n-----\nEnabled:   Yes\nDirection:  In\nProfiles:  Domain,Private\nProtocol:  TCP\nLocalPort:  5000-6000\nAction:  Allow\n';
  assert.equal(analizarFirewall(texto, { perfil: 'private' }).permitido, true);
  assert.equal(analizarFirewall(texto, { perfil: 'public' }).permitido, false);
});

test('la verificación HTTP exige que conteste El Rancho, no cualquier servidor', async () => {
  const respuestaCon = (html, ok = true) => async () => ({ ok, text: async () => html });
  assert.equal(await responde('http://x', { fetchImpl: respuestaCon('<title>El Rancho</title>') }), true);
  assert.equal(await responde('http://x', { fetchImpl: respuestaCon('<title>Otro proyecto</title>') }), false);
  assert.equal(await responde('http://x', { fetchImpl: async () => { throw new Error('timeout'); } }), false);
});

test('el CLI decide desde el JSON de PowerShell (con BOM) y el QR no acepta credenciales', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rancho-lan-'));
  const interfaces = join(dir, 'interfaces.json');
  await writeFile(interfaces, `\uFEFF${JSON.stringify([...virtuales, loopback])}`, 'utf8');
  const { stdout } = await ejecutar(process.execPath, ['scripts/lan-launcher.mjs', 'detectar', interfaces], { cwd: new URL('..', import.meta.url) });
  assert.equal(JSON.parse(stdout).estado, 'sin_red');

  const qr = join(dir, 'qr.png');
  await ejecutar(process.execPath, ['scripts/print-local-qr.mjs', 'http://192.168.137.1:5173', '--png', qr], { cwd: new URL('..', import.meta.url) });
  const png = await readFile(qr);
  assert.deepEqual([...png.subarray(1, 4)].map((b) => String.fromCharCode(b)).join(''), 'PNG');
  await assert.rejects(ejecutar(process.execPath, ['scripts/print-local-qr.mjs', 'http://usuario:clave@192.168.1.4:5173'], { cwd: new URL('..', import.meta.url) }));
  await assert.rejects(ejecutar(process.execPath, ['scripts/print-local-qr.mjs', 'http://192.168.1.4:5173/?token=abc'], { cwd: new URL('..', import.meta.url) }));
});
