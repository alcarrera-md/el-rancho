// Inicio móvil sin configuración (launcher de El Rancho).
//
// PowerShell reúne los datos crudos del equipo (interfaces, perfil de red,
// ICS, reglas del Firewall vía netsh) y este módulo decide, con reglas
// explícitas y probables, qué dirección debe abrir el celular. No cambia nada
// del sistema: solo lee y responde JSON.
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

export const PUERTO_FRONTEND = 5173;

// Adaptadores que nunca son la red del celular: virtualización, VPN, túneles.
const PATRON_IGNORADO = /hyper-v|vethernet|\bwsl\b|docker|vmware|virtualbox|vbox|host-only|\bvpn\b|tap-windows|tap adapter|wintun|wireguard|tailscale|zerotier|openvpn|fortinet|anyconnect|pangp|globalprotect|bluetooth|npcap|loopback|teredo|isatap|6to4/i;
// Adaptador que Windows crea al activar Mobile Hotspot (Wi-Fi Direct / red hospedada).
const PATRON_HOTSPOT = /wi-?fi direct virtual adapter|hosted network virtual adapter|virtual wifi miniport/i;

function ipAEntero(ip) {
  const partes = String(ip).split('.').map(Number);
  if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((partes[0] << 24) >>> 0) + (partes[1] << 16) + (partes[2] << 8) + partes[3];
}

function enRango(ip, base, prefijo) {
  const valor = ipAEntero(ip);
  const inicio = ipAEntero(base);
  if (valor === null || inicio === null) return false;
  const mascara = prefijo === 0 ? 0 : (0xffffffff << (32 - prefijo)) >>> 0;
  return (valor & mascara) === (inicio & mascara);
}

export function esIpPrivada(ip) {
  return enRango(ip, '10.0.0.0', 8) || enRango(ip, '172.16.0.0', 12) || enRango(ip, '192.168.0.0', 16);
}

const esApipa = (ip) => enRango(ip, '169.254.0.0', 16);
const esLoopback = (ip) => enRango(ip, '127.0.0.0', 8);

/**
 * Clasifica cada interfaz y explica por qué se usa o se ignora.
 * Prioridad: 0 Mobile Hotspot/ICS, 1 Wi-Fi/Ethernet con gateway,
 * 2 red local privada sin gateway (router sin Internet, cable directo).
 */
export function clasificarInterfaces(interfaces = []) {
  const candidatos = [];
  const ignorados = [];
  for (const interfaz of interfaces) {
    const etiqueta = `${interfaz.nombre || ''} ${interfaz.descripcion || ''}`.trim();
    const ignorar = (motivo) => ignorados.push({ nombre: interfaz.nombre, descripcion: interfaz.descripcion, motivo });
    if (String(interfaz.estado).toLowerCase() !== 'up') { ignorar('desconectada'); continue; }
    if (/loopback|tunnel/i.test(String(interfaz.tipo))) { ignorar('interfaz interna'); continue; }
    const esHotspot = PATRON_HOTSPOT.test(etiqueta) || interfaz.ics_privada === true;
    if (!esHotspot && PATRON_IGNORADO.test(etiqueta)) { ignorar('virtual, VPN o túnel'); continue; }
    const direcciones = (interfaz.ipv4 || []).filter((d) => d?.ip && !esLoopback(d.ip));
    if (!direcciones.length) { ignorar('sin IPv4'); continue; }
    const utiles = direcciones.filter((d) => !esApipa(d.ip));
    if (!utiles.length) { ignorar('solo dirección automática 169.254 (sin red real)'); continue; }
    const privadas = utiles.filter((d) => esIpPrivada(d.ip));
    if (!privadas.length) { ignorar('dirección no privada'); continue; }
    const gateways = (interfaz.gateways || []).filter((g) => g && g !== '0.0.0.0');
    const inalambrica = /wireless|80211/i.test(String(interfaz.tipo)) || /wi-?fi|wlan|inal[aá]mbric/i.test(etiqueta);
    let clase;
    let prioridad;
    let modo;
    if (esHotspot) {
      clase = 'hotspot'; prioridad = 0; modo = 'Celular por Mobile Hotspot';
    } else if (gateways.length) {
      clase = inalambrica ? 'wifi' : 'ethernet'; prioridad = 1; modo = inalambrica ? 'Red local Wi-Fi' : 'Red local Ethernet';
    } else {
      clase = 'local_sin_gateway'; prioridad = 2; modo = inalambrica ? 'Red local Wi-Fi sin Internet' : 'Red local sin Internet';
    }
    for (const direccion of privadas) {
      candidatos.push({
        ip: direccion.ip,
        prefijo: direccion.prefijo ?? null,
        nombre: interfaz.nombre,
        descripcion: interfaz.descripcion,
        clase,
        prioridad,
        modo,
        gateway: gateways[0] || null,
        metrica: Number.isFinite(Number(interfaz.metrica)) ? Number(interfaz.metrica) : 9999,
        categoria: interfaz.categoria || null,
        clientes_hotspot: esHotspot ? (interfaz.clientes ?? null) : null,
      });
    }
  }
  candidatos.sort((a, b) => a.prioridad - b.prioridad || a.metrica - b.metrica || String(a.nombre).localeCompare(String(b.nombre)) || String(a.ip).localeCompare(String(b.ip)));
  return { candidatos, ignorados };
}

/**
 * Elige la dirección del celular entre las que realmente responden.
 * `alcanzables` es el conjunto de IP donde El Rancho (Vite) contestó.
 */
export function decidirDireccion({ candidatos }, alcanzables, puerto = PUERTO_FRONTEND, protocolo = 'http') {
  const url = (ip) => `${protocolo}://${ip}:${puerto}`;
  const verificados = candidatos.filter((c) => alcanzables.has(c.ip));
  const sinRespuesta = candidatos.filter((c) => !alcanzables.has(c.ip)).map((c) => ({ ...c, url: url(c.ip) }));
  if (!candidatos.length) {
    return { estado: 'sin_red', mensaje: 'No se encontró ninguna red local válida. Conecta la laptop a un Wi-Fi o activa Mobile Hotspot.', elegido: null, alternativas: [], sin_respuesta: [] };
  }
  if (!verificados.length) {
    return { estado: 'sin_respuesta', mensaje: `El Rancho no respondió en ninguna dirección de red en el puerto ${puerto}.`, elegido: null, alternativas: [], sin_respuesta: sinRespuesta };
  }
  const [elegido, ...resto] = verificados.map((c) => ({ ...c, url: url(c.ip) }));
  // Dos redes igual de plausibles (p. ej. Wi-Fi y Ethernet con gateway): no
  // se elige en silencio; se muestran ambas con claridad.
  const ambiguo = resto.some((c) => c.prioridad === elegido.prioridad);
  return {
    estado: ambiguo ? 'ambiguo' : 'ok',
    mensaje: ambiguo ? 'Hay varias redes locales activas. Abre en el celular la de la red a la que está conectado.' : null,
    modo: elegido.modo,
    elegido,
    alternativas: resto,
    sin_respuesta: sinRespuesta,
  };
}

// --- Firewall (salida de `netsh advfirewall firewall show rule name=all dir=in verbose`) ---
const CAMPOS = {
  nombre: /^(nombre de regla|rule name)\s*:\s*(.*)$/i,
  habilitada: /^(habilitada|enabled)\s*:\s*(.*)$/i,
  direccion: /^(direcci[oó]n|direction)\s*:\s*(.*)$/i,
  perfiles: /^(perfiles|profiles)\s*:\s*(.*)$/i,
  protocolo: /^(protocolo|protocol)\s*:\s*(.*)$/i,
  puerto: /^localport\s*:\s*(.*)$/i,
  programa: /^(programa|program)\s*:\s*(.*)$/i,
  accion: /^(acci[oó]n|action)\s*:\s*(.*)$/i,
};
const CUALQUIERA = /^(cualquiera|any|todos|all)$/i;
const PERFIL = { private: /privad|private/i, public: /p[uú]blic/i, domain: /dominio|domain/i };

function valor(linea, patron) {
  const m = patron.exec(linea.trim());
  return m ? m[m.length - 1].trim() : null;
}

export function leerReglasNetsh(texto) {
  const reglas = [];
  let actual = null;
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const nombre = valor(linea, CAMPOS.nombre);
    if (nombre !== null) { actual = { nombre }; reglas.push(actual); continue; }
    if (!actual) continue;
    for (const [campo, patron] of Object.entries(CAMPOS)) {
      if (campo === 'nombre') continue;
      const v = valor(linea, patron);
      if (v !== null) actual[campo] = v;
    }
  }
  return reglas;
}

function puertoCoincide(especificacion, puerto) {
  if (!especificacion || CUALQUIERA.test(especificacion)) return true;
  return especificacion.split(',').some((parte) => {
    const [inicio, fin] = parte.trim().split('-').map(Number);
    return fin ? puerto >= inicio && puerto <= fin : puerto === inicio;
  });
}

function aplicaA(regla, perfil, puerto) {
  const si = /^(s[ií]|yes)$/i.test(regla.habilitada || '');
  const entrada = /^(dentro|in)$/i.test(regla.direccion || '');
  const perfiles = regla.perfiles || '';
  const perfilOk = CUALQUIERA.test(perfiles) || (PERFIL[perfil] ? PERFIL[perfil].test(perfiles) : false);
  const protocoloOk = !regla.protocolo || CUALQUIERA.test(regla.protocolo) || /^tcp$/i.test(regla.protocolo);
  const programaNode = Boolean(regla.programa) && /node\.exe$/i.test(regla.programa);
  const programaOk = !regla.programa || CUALQUIERA.test(regla.programa) || programaNode;
  const puertoExplicito = Boolean(regla.puerto) && !CUALQUIERA.test(regla.puerto) && puertoCoincide(regla.puerto, puerto);
  // Solo cuentan reglas que nombran el puerto o el programa node.exe; las de
  // otras aplicaciones (p. ej. de la Tienda, sin puerto ni programa) no aplican.
  return si && entrada && perfilOk && protocoloOk && programaOk && puertoCoincide(regla.puerto, puerto) && (puertoExplicito || programaNode);
}

/**
 * ¿Permite el Firewall conexiones entrantes TCP al puerto en ese perfil?
 * Una regla de bloqueo aplicable tiene prioridad sobre cualquier permiso.
 */
export function analizarFirewall(texto, { perfil = 'private', puerto = PUERTO_FRONTEND } = {}) {
  if (!texto) return { legible: false, permitido: null, reglas: [], bloqueos: [] };
  const reglas = leerReglasNetsh(texto).filter((regla) => aplicaA(regla, perfil, puerto));
  const bloqueos = reglas.filter((regla) => /bloquear|block/i.test(regla.accion || '')).map((r) => r.nombre);
  const permisos = reglas.filter((regla) => /permitir|allow/i.test(regla.accion || '')).map((r) => r.nombre);
  return { legible: true, permitido: !bloqueos.length && permisos.length > 0, reglas: permisos, bloqueos };
}

export function perfilDesdeCategoria(categoria) {
  if (/public/i.test(String(categoria))) return 'public';
  if (/domain|dominio/i.test(String(categoria))) return 'domain';
  if (/private|privad/i.test(String(categoria))) return 'private';
  return null;
}

// HTTPS con la CA local del equipo (modo app instalable): fetch de Node no
// permite indicar una CA propia, así que se usa https.get.
function obtenerHttps(url, { ca, timeoutMs }) {
  return new Promise((resolve) => {
    const peticion = https.get(url, { ca, timeout: timeoutMs }, (respuesta) => {
      let cuerpo = '';
      respuesta.setEncoding('utf8');
      respuesta.on('data', (trozo) => { if (cuerpo.length < 65536) cuerpo += trozo; });
      respuesta.on('end', () => resolve({ ok: respuesta.statusCode >= 200 && respuesta.statusCode < 300, texto: cuerpo }));
    });
    peticion.on('timeout', () => peticion.destroy());
    peticion.on('error', () => resolve(null));
  });
}

// --- Verificación HTTP(S): debe contestar El Rancho, no cualquier servidor ---
export async function responde(url, { timeoutMs = 2500, fetchImpl = fetch, ca = null, exigirTitulo = true } = {}) {
  try {
    let ok;
    let texto;
    if (ca && url.startsWith('https:')) {
      const respuesta = await obtenerHttps(url, { ca, timeoutMs });
      if (!respuesta) return false;
      ({ ok, texto } = respuesta);
    } else {
      const respuesta = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
      ok = respuesta.ok;
      texto = exigirTitulo ? await respuesta.text() : '';
    }
    if (!ok) return false;
    return exigirTitulo ? /<title>El Rancho<\/title>/i.test(texto) : true;
  } catch {
    return false;
  }
}

async function detectar(rutaInterfaces, rutaFirewall, puerto, { protocolo = 'http', ca = null, puertosFirewall = null } = {}) {
  const interfaces = JSON.parse((await readFile(rutaInterfaces, 'utf8')).replace(/^\uFEFF/, ''));
  const clasificacion = clasificarInterfaces(Array.isArray(interfaces) ? interfaces : [interfaces]);
  const pruebas = await Promise.all(clasificacion.candidatos.map(async (c) => [c.ip, await responde(`${protocolo}://${c.ip}:${puerto}/`, { ca })]));
  const alcanzables = new Set(pruebas.filter(([, ok]) => ok).map(([ip]) => ip));
  const decision = decidirDireccion(clasificacion, alcanzables, puerto, protocolo);
  let firewall = null;
  if (decision.elegido) {
    const texto = rutaFirewall ? await readFile(rutaFirewall, 'utf8').catch(() => '') : '';
    const perfil = perfilDesdeCategoria(decision.elegido.categoria);
    // Con varios puertos (app HTTPS + descarga del certificado) todos deben estar permitidos.
    const analisis = (puertosFirewall || [puerto]).map((p) => analizarFirewall(texto, { perfil: perfil || 'private', puerto: p }));
    firewall = {
      perfil,
      legible: analisis.every((a) => a.legible),
      permitido: analisis.every((a) => a.permitido),
      reglas: [...new Set(analisis.flatMap((a) => a.reglas))],
      bloqueos: [...new Set(analisis.flatMap((a) => a.bloqueos))],
    };
  }
  return { ...decision, ips_candidatas: clasificacion.candidatos.map((c) => c.ip), ignorados: clasificacion.ignorados, firewall };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [comando, rutaInterfaces, ...resto] = process.argv.slice(2);
  const opcion = (nombre) => { const i = resto.indexOf(nombre); return i >= 0 ? resto[i + 1] : null; };
  const ca = opcion('--ca') ? await readFile(opcion('--ca')) : null;
  if (comando === 'verificar' && rutaInterfaces) {
    // verificar <url> [--ca pem] [--sin-titulo]: sale 0 si responde.
    const ok = await responde(rutaInterfaces, { ca, timeoutMs: 4000, exigirTitulo: !resto.includes('--sin-titulo') });
    process.exit(ok ? 0 : 1);
  }
  if (comando !== 'detectar' || !rutaInterfaces) {
    console.error('Uso: node lan-launcher.mjs detectar <interfaces.json> [--firewall netsh.txt] [--puerto 5173] [--protocolo https --ca ca.pem] [--puertos-firewall 5443,5180]');
    process.exit(2);
  }
  const puertosFirewall = opcion('--puertos-firewall') ? opcion('--puertos-firewall').split(',').map(Number).filter(Boolean) : null;
  const salida = await detectar(rutaInterfaces, opcion('--firewall'), Number(opcion('--puerto')) || PUERTO_FRONTEND, {
    protocolo: opcion('--protocolo') === 'https' ? 'https' : 'http', ca, puertosFirewall,
  });
  process.stdout.write(JSON.stringify(salida));
}
