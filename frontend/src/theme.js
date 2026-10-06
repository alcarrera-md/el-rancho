export const PREFERENCIAS_APARIENCIA_DEFAULT = Object.freeze({
  tema: 'claro', paleta: 'rancho', texto: 'normal', densidad: 'comoda', contraste: 'normal', esquinas: 'suaves',
});

const OPCIONES = Object.freeze({
  tema: ['claro', 'oscuro', 'automatico'], paleta: ['rancho', 'tierra', 'bosque', 'noche', 'azul'],
  texto: ['normal', 'grande', 'muy-grande'], densidad: ['comoda', 'compacta'],
  contraste: ['normal', 'alto'], esquinas: ['rectas', 'suaves', 'redondas'],
});
const CLAVE_ACTIVA = 'el-rancho:apariencia-activa';
let dejarDeEscucharSistema = null;

function almacenamiento() { return typeof window !== 'undefined' ? window.localStorage : null; }
function claveUsuario(usuarioId) { return `el-rancho:apariencia:${usuarioId || 'local'}`; }

export function normalizarPreferenciasApariencia(valor = {}) {
  return Object.fromEntries(Object.entries(PREFERENCIAS_APARIENCIA_DEFAULT).map(([clave, predeterminado]) => [
    clave, OPCIONES[clave].includes(valor?.[clave]) ? valor[clave] : predeterminado,
  ]));
}

function leer(clave) {
  try { return JSON.parse(almacenamiento()?.getItem(clave) || 'null'); } catch { return null; }
}

// Antes el tema predeterminado era "automatico" y se guardaba en cada carga
// aunque nadie lo eligiera. Solo se respeta "automatico" cuando la persona lo
// eligió en Apariencia (temaElegido); si no, se usa el claro predeterminado.
// "claro" y "oscuro" guardados siempre fueron elecciones explícitas.
export function obtenerPreferenciasApariencia(usuarioId) {
  const guardadas = (usuarioId ? leer(claveUsuario(usuarioId)) : leer(CLAVE_ACTIVA)) || PREFERENCIAS_APARIENCIA_DEFAULT;
  const automaticoElegido = guardadas?.tema === 'automatico' && guardadas.temaElegido === true;
  const preferencias = normalizarPreferenciasApariencia(
    guardadas?.tema === 'automatico' && !automaticoElegido ? { ...guardadas, tema: PREFERENCIAS_APARIENCIA_DEFAULT.tema } : guardadas
  );
  return automaticoElegido ? { ...preferencias, temaElegido: true } : preferencias;
}

function modoEfectivo(tema, media) { return tema === 'automatico' ? (media?.matches ? 'oscuro' : 'claro') : tema; }

export function aplicarPreferenciasApariencia(valor, usuarioId, { elegidas = false } = {}) {
  const normalizadas = normalizarPreferenciasApariencia(valor);
  const preferencias = normalizadas.tema === 'automatico' && (elegidas || valor?.temaElegido === true)
    ? { ...normalizadas, temaElegido: true }
    : normalizadas;
  if (typeof document === 'undefined') return preferencias;
  if (dejarDeEscucharSistema) dejarDeEscucharSistema();
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const aplicarModo = () => { document.documentElement.dataset.mode = modoEfectivo(preferencias.tema, media); };
  aplicarModo();
  if (preferencias.tema === 'automatico' && media) {
    media.addEventListener?.('change', aplicarModo);
    dejarDeEscucharSistema = () => media.removeEventListener?.('change', aplicarModo);
  } else dejarDeEscucharSistema = null;
  document.documentElement.dataset.palette = preferencias.paleta;
  document.documentElement.dataset.textSize = preferencias.texto;
  document.documentElement.dataset.density = preferencias.densidad;
  document.documentElement.dataset.contrast = preferencias.contraste;
  document.documentElement.dataset.corners = preferencias.esquinas;
  try {
    almacenamiento()?.setItem(CLAVE_ACTIVA, JSON.stringify(preferencias));
    if (usuarioId) almacenamiento()?.setItem(claveUsuario(usuarioId), JSON.stringify(preferencias));
  } catch {
    // La apariencia sigue aplicada aunque el navegador bloquee almacenamiento local.
  }
  return preferencias;
}

export function obtenerTema() { return obtenerPreferenciasApariencia().tema; }
export function aplicarTema(tema) {
  return aplicarPreferenciasApariencia({ ...obtenerPreferenciasApariencia(), tema: tema === 'gris' ? 'claro' : tema });
}
