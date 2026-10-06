import { api, getToken } from '../api.js';
import { tienePermiso } from '../authorization/permissions.js';
import {
  actualizarOperacionLocal,
  confirmarOperacionSincronizada,
  eliminarConflictoLocal,
  eliminarOperacionLocal,
  guardarHistorialSincronizado,
  guardarOperacionLocal,
  listarConflictosLocal,
  listarHistorialSincronizacionLocal,
  listarOperacionesLocal,
  moverOperacionAConflicto,
} from './campoDB.js';
import { esFalloDeConectividad } from './connectivity.js';
import { obtenerInstalacionId } from './instalacion.js';
import { decodificarJWT } from './jwt.js';
import { generarUUID } from './uuid.js';

export const EVENTO_COLA_OFFLINE = 'offline:queue-changed';

export const TIPO_OPERACION = Object.freeze({
  PESAJE: 'pesaje.crear',
  NOTA: 'nota_seguimiento.crear',
  OBSERVACION: 'animal.reportar_observacion',
  COMPLETAR_TAREA: 'asignacion_tarea.completar',
  ALIMENTACION: 'alimentacion.crear',
  MOVIMIENTO: 'animal.trasladar',
  EVENTO_SALUD: 'evento_salud.crear',
  CONDICION_CORPORAL: 'condicion_corporal.crear',
});

const CONTRATOS = Object.freeze({
  [TIPO_OPERACION.PESAJE]: { recurso: 'pesajes', accion: 'crear', entidad: 'pesaje', etiqueta: 'Registrar pesaje' },
  [TIPO_OPERACION.NOTA]: { recurso: 'notas_seguimiento', accion: 'crear', entidad: 'nota_seguimiento', etiqueta: 'Agregar nota' },
  [TIPO_OPERACION.OBSERVACION]: { recurso: 'animales', accion: 'reportar_observacion', entidad: 'animal', etiqueta: 'Reportar revisión' },
  [TIPO_OPERACION.COMPLETAR_TAREA]: { recurso: 'asignaciones', accion: 'completar', entidad: 'asignacion_tarea', etiqueta: 'Completar tarea' },
  [TIPO_OPERACION.ALIMENTACION]: { recurso: 'alimentacion', accion: 'crear', entidad: 'alimentacion', etiqueta: 'Registrar alimentación' },
  [TIPO_OPERACION.MOVIMIENTO]: { recurso: 'animales', accion: 'editar', entidad: 'animal', etiqueta: 'Mover animal' },
  [TIPO_OPERACION.EVENTO_SALUD]: { recurso: 'salud', accion: 'crear', entidad: 'evento_salud', etiqueta: 'Registrar evento sanitario' },
  [TIPO_OPERACION.CONDICION_CORPORAL]: { recurso: 'condicion_corporal', accion: 'crear', entidad: 'condicion_corporal', etiqueta: 'Registrar condición corporal' },
});
const MAX_PAYLOAD_BYTES = 100 * 1024;
const MAX_DEPENDENCIAS = 10;
const TAMANO_LOTE = 25;
const UUID_OPERACION = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Estados locales (en español, persistidos desde v1) y su equivalente del
// contrato P8. "sincronizada" no se guarda en la cola: pasa a historial_sync.
export const ESTADO_SYNC = Object.freeze({
  pendiente: 'pending',
  bloqueada: 'pending',
  sincronizando: 'syncing',
  sincronizada: 'synced',
  conflicto: 'conflict',
  error: 'failed',
});
const CLAVE_SENSIBLE = /(?:password|contrasena|contraseña|token|secret|authorization|jwt)/i;

// Operaciones con estado sobre un mismo registro deben aplicarse en orden:
// si una queda en conflicto o error, las siguientes del mismo registro
// esperan (no se envían con una premisa que ya no es cierta). Los eventos
// append-only (pesaje, nota) no bloquean ni se bloquean entre sí.
export function claveBloqueoOperacion(operacion) {
  if (operacion?.clave_bloqueo) return operacion.clave_bloqueo;
  const id = operacion?.entidad_id;
  switch (operacion?.tipo) {
    case TIPO_OPERACION.MOVIMIENTO: return id ? `animal:${id}:ubicacion` : null;
    case TIPO_OPERACION.OBSERVACION: return id ? `animal:${id}:salud` : null;
    case TIPO_OPERACION.COMPLETAR_TAREA: return id ? `tarea:${id}` : null;
    case TIPO_OPERACION.ALIMENTACION: return operacion.payload?.insumo_id ? `insumo:${operacion.payload.insumo_id}` : null;
    default: return null;
  }
}

// La cola se ordena por creada_en. Dos capturas en el mismo milisegundo
// (p. ej. dos toques rápidos) empatarían y podrían enviarse invertidas, así
// que creada_en es estrictamente creciente en este dispositivo. fecha_local
// conserva la hora real de captura.
let ultimaCreacionMs = 0;
function marcaCreacion(ahora) {
  ultimaCreacionMs = Math.max(ahora.getTime(), ultimaCreacionMs + 1);
  return new Date(ultimaCreacionMs).toISOString();
}

let sincronizaciones = new Map();
let progresos = new Map();
let temporizadoresReintento = new Map();
const RETRASOS_REINTENTO_MS = [5_000, 15_000, 45_000, 60_000];

function emitirCambio(usuarioId) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENTO_COLA_OFFLINE, { detail: { usuario_id: usuarioId } }));
  }
}

function uuid() {
  return generarUUID();
}

function errorPublico(error) {
  if (error?.status === 403) return {
    code: error?.code || 'FORBIDDEN',
    message: 'Tu rol ya no permite este cambio.',
    status: 403,
    tipo: 'permiso',
  };
  if (error?.status === 401) return { code: 'SESSION_REQUIRED', message: 'Inicia sesión nuevamente para sincronizar.', status: 401, tipo: 'sesion' };
  if (error?.status >= 500) return { code: 'SERVER_TEMPORARY', message: 'El servidor no pudo recibir el cambio. Se intentará nuevamente.', status: error.status, tipo: 'servidor' };
  if (error?.name === 'AbortError' || error?.code === 'TIMEOUT') return { code: 'SYNC_TIMEOUT', message: 'El envío tardó demasiado. Se intentará nuevamente.', status: null, tipo: 'timeout' };
  if (esFalloDeConectividad(error)) return { code: 'CONNECTION_LOST', message: 'Se perdió la conexión. El cambio sigue guardado.', status: null, tipo: 'conexion' };
  if ([403, 404, 409].includes(error?.status)) return {
    code: error?.code || `SYNC_CONFLICT_${error.status}`,
    message: 'La información cambió y el registro necesita revisión.',
    status: error.status,
    tipo: 'conflicto',
    details: Array.isArray(error?.details) ? error.details.map((detalle) => ({
      field: detalle?.field,
      message: detalle?.message,
      observado: detalle?.observado,
      actual: detalle?.actual,
      unidad_medida: detalle?.unidad_medida,
      version_observada: detalle?.version_observada,
      version_actual: detalle?.version_actual,
      fecha_caducidad: detalle?.fecha_caducidad,
      destino: detalle?.destino,
      corral_observado: detalle?.corral_observado,
      corral_actual: detalle?.corral_actual,
      corral_destino: detalle?.corral_destino,
      capacidad_observada: detalle?.capacidad_observada,
      capacidad_actual: detalle?.capacidad_actual,
      fecha_evento: detalle?.fecha_evento,
      insumo: detalle?.insumo,
      requerido: detalle?.requerido,
      disponible: detalle?.disponible,
      fecha_baja: detalle?.fecha_baja,
      estado: detalle?.estado,
    })) : undefined,
  };
  return {
    code: error?.code || 'SYNC_ERROR',
    message: 'No se pudo enviar esta captura. Revisa los datos antes de reintentar.',
    status: error?.status || null,
    tipo: 'datos',
  };
}

function validarPayloadLocal(payload) {
  const visitar = (valor) => {
    if (!valor || typeof valor !== 'object') return;
    for (const [clave, contenido] of Object.entries(valor)) {
      if (CLAVE_SENSIBLE.test(clave)) throw new Error('La captura contiene información que no puede guardarse sin conexión.');
      visitar(contenido);
    }
  };
  visitar(payload);
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (bytes > MAX_PAYLOAD_BYTES) throw new Error('La captura supera el tamaño máximo permitido para sincronización.');
}

export function etiquetaOperacion(tipo) {
  return CONTRATOS[tipo]?.etiqueta || 'Cambio de campo';
}

export function construirOperacion({ usuario, tipo, entidadId = null, payload, contextoPublico = null, ahora = new Date(), id = uuid(), dependeDe = [], versionBase = null }) {
  const contrato = CONTRATOS[tipo];
  if (!contrato) throw new Error('La operación no está habilitada sin conexión.');
  if (!usuario?.id || !tienePermiso(usuario.rol, contrato.recurso, contrato.accion)) {
    const error = new Error('Tu rol no permite registrar esta operación.');
    error.code = 'FORBIDDEN';
    throw error;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('La captura offline no es válida.');
  validarPayloadLocal(payload);
  const dependencias = [...new Set((dependeDe || []).map((valor) => String(valor).toLowerCase()))];
  if (dependencias.length > MAX_DEPENDENCIAS || dependencias.some((valor) => !UUID_OPERACION.test(valor) || valor === String(id).toLowerCase())) {
    throw new Error('Las dependencias de la captura no son válidas.');
  }
  const fecha = ahora.toISOString();
  return {
    id,
    usuario_id: usuario.id,
    client_operation_id: id,
    installation_id: obtenerInstalacionId(),
    tipo,
    entidad: contrato.entidad,
    entidad_id: entidadId === null ? null : Number(entidadId),
    payload: structuredClone(payload),
    contexto_publico: contextoPublico?.entidad ? { entidad: String(contextoPublico.entidad).slice(0, 160) } : null,
    depende_de: dependencias,
    version_base: versionBase === null || versionBase === undefined ? null : Number(versionBase),
    fecha_local: fecha,
    estado: 'pendiente',
    intentos: 0,
    ultimo_error: null,
    creada_en: marcaCreacion(ahora),
    actualizada_en: fecha,
  };
}

export async function encolarOperacion(datos) {
  const operacion = datos?.usuario_id ? structuredClone(datos) : construirOperacion(datos);
  // Completar la misma tarea dos veces no es una operación append-only.
  // Si ya está pendiente, devolvemos la captura existente en lugar de
  // crear dos intenciones distintas.
  if (operacion.tipo === TIPO_OPERACION.COMPLETAR_TAREA) {
    const existentes = await listarOperacionesLocal(operacion.usuario_id, ['pendiente', 'sincronizando', 'error']);
    const previa = existentes.find((fila) => fila.tipo === operacion.tipo && Number(fila.entidad_id) === operacion.entidad_id);
    if (previa) return previa;
  }
  await guardarOperacionLocal(operacion);
  emitirCambio(operacion.usuario_id);
  return operacion;
}

export async function capturarConSoporteOffline({ usuario, sinConexion, tipo, entidadId, payload, contextoPublico, ejecutarOnline }) {
  const operacion = construirOperacion({ usuario, tipo, entidadId, payload, contextoPublico });
  if (sinConexion) {
    await guardarOperacionLocal(operacion);
    emitirCambio(usuario.id);
    return { offline_pending: true, operacion };
  }
  try {
    const resultado = await ejecutarOnline(operacion);
    await guardarHistorialSincronizado(operacion).catch((error) => console.warn('[offline-sync-history]', error));
    emitirCambio(usuario.id);
    return { offline_pending: false, resultado };
  } catch (error) {
    // La solicitud pudo haber sido aplicada por el servidor antes de
    // perderse la respuesta. Conservamos exactamente el mismo UUID para
    // que el próximo envío sea un replay idempotente, no un duplicado.
    if (!esFalloDeConectividad(error)) throw error;
    await guardarOperacionLocal(operacion);
    emitirCambio(usuario.id);
    return { offline_pending: true, operacion };
  }
}

export function metadataOperacion(operacion, offline = true) {
  return {
    offline,
    id: operacion.client_operation_id,
    installationId: operacion.installation_id,
    fechaLocal: operacion.fecha_local,
  };
}

export async function enviarOperacion(operacion) {
  const propietarioToken = decodificarJWT(getToken())?.id;
  if (!propietarioToken || String(propietarioToken) !== String(operacion.usuario_id)) {
    const error = new Error('Inicia sesión con la misma cuenta que creó esta captura para sincronizarla.');
    error.status = 401;
    error.code = 'SESSION_OWNER_MISMATCH';
    throw error;
  }
  const metadata = metadataOperacion(operacion, true);
  switch (operacion.tipo) {
    case TIPO_OPERACION.PESAJE:
      return api.registrarPesaje(operacion.payload, metadata);
    case TIPO_OPERACION.NOTA:
      return api.crearNota(operacion.payload, metadata);
    case TIPO_OPERACION.OBSERVACION:
      return api.cambiarEstadoSalud(operacion.entidad_id, operacion.payload, metadata);
    case TIPO_OPERACION.COMPLETAR_TAREA:
      return api.completarTarea(operacion.entidad_id, true, operacion.payload.expected_version, metadata);
    case TIPO_OPERACION.ALIMENTACION:
      return api.registrarAlimentacion(operacion.payload, metadata);
    case TIPO_OPERACION.MOVIMIENTO:
      return api.trasladarAnimal(operacion.entidad_id, operacion.payload, metadata);
    case TIPO_OPERACION.EVENTO_SALUD:
      return api.registrarSalud(operacion.payload, metadata);
    case TIPO_OPERACION.CONDICION_CORPORAL:
      return api.registrarCondicion(operacion.payload, metadata);
    default:
      throw new Error('Tipo de operación offline desconocido.');
  }
}

export function calcularRetardoReintento(intentos = 1) {
  return RETRASOS_REINTENTO_MS[Math.min(Math.max(Number(intentos) - 1, 0), RETRASOS_REINTENTO_MS.length - 1)];
}

// ±20 % para que varios dispositivos que recuperan señal a la vez no
// reintenten exactamente en el mismo instante.
export function aplicarJitter(retardoMs, aleatorio = Math.random()) {
  return Math.round(retardoMs * (0.8 + 0.4 * Math.min(Math.max(aleatorio, 0), 1)));
}

function cancelarReintento(usuarioId) {
  const temporizador = temporizadoresReintento.get(usuarioId);
  if (temporizador) clearTimeout(temporizador);
  temporizadoresReintento.delete(usuarioId);
}

function programarReintento(usuario, intentos) {
  if (temporizadoresReintento.has(usuario.id)) return;
  const temporizador = setTimeout(() => {
    temporizadoresReintento.delete(usuario.id);
    void sincronizarOperacionesPendientes(usuario).catch(() => {});
  }, aplicarJitter(calcularRetardoReintento(intentos)));
  temporizador.unref?.();
  temporizadoresReintento.set(usuario.id, temporizador);
}

const MENSAJE_BLOQUEADA = Object.freeze({
  code: 'BLOQUEADA_POR_CAMBIO_ANTERIOR',
  message: 'Espera la revisión de un cambio anterior del mismo registro.',
  status: null,
  tipo: 'bloqueo',
});

async function procesar(usuario, enviar, autoRetry) {
  // Una pestaña o cierre abrupto puede dejar una fila marcada como
  // sincronizando. Al iniciar una nueva ronda vuelve a ser reintentable;
  // el recibo idempotente del backend decide si debe aplicarse o repetirse.
  // Las bloqueadas se reevalúan en cada ronda: si el conflicto que las
  // detenía ya se descartó o reintentó, vuelven a enviarse.
  const [todas, conflictos, conError] = await Promise.all([
    listarOperacionesLocal(usuario.id, ['pendiente', 'sincronizando', 'bloqueada']),
    listarConflictosLocal(usuario.id),
    listarOperacionesLocal(usuario.id, ['error']),
  ]);
  if (!todas.length) {
    cancelarReintento(usuario.id);
    return obtenerEstadoCola(usuario.id);
  }
  const clavesBloqueadas = new Set();
  const idsBloqueados = new Set();
  const bloquear = (operacion) => {
    idsBloqueados.add(String(operacion.id).toLowerCase());
    const clave = claveBloqueoOperacion(operacion);
    if (clave) clavesBloqueadas.add(clave);
  };
  [...conflictos, ...conError].forEach(bloquear);

  progresos.set(usuario.id, { activo: true, actual: 0, total: todas.length });
  emitirCambio(usuario.id);
  let reintento = null;
  try {
    for (let indice = 0; indice < todas.length; indice += 1) {
      const operacion = todas[indice];
      if (String(operacion.usuario_id) !== String(usuario.id)) continue;
      // Cesión del hilo entre lotes: la cola sigue siendo secuencial, pero
      // cientos de capturas no congelan la interfaz.
      if (indice > 0 && indice % TAMANO_LOTE === 0) await new Promise((resolve) => { setTimeout(resolve, 0); });
      progresos.set(usuario.id, { activo: true, actual: indice + 1, total: todas.length });
      const clave = claveBloqueoOperacion(operacion);
      const dependeDeBloqueada = (operacion.depende_de || []).some((id) => idsBloqueados.has(String(id).toLowerCase()));
      if ((clave && clavesBloqueadas.has(clave)) || dependeDeBloqueada) {
        bloquear(operacion);
        if (operacion.estado !== 'bloqueada') {
          await actualizarOperacionLocal(operacion.id, usuario.id, { estado: 'bloqueada', ultimo_error: MENSAJE_BLOQUEADA });
          emitirCambio(usuario.id);
        }
        continue;
      }
      const intentoActual = Number(operacion.intentos || 0) + 1;
      await actualizarOperacionLocal(operacion.id, usuario.id, {
        estado: 'sincronizando',
        intentos: intentoActual,
        ultimo_error: null,
      });
      emitirCambio(usuario.id);
      try {
        await enviar(operacion);
        await confirmarOperacionSincronizada(operacion.id, usuario.id);
        emitirCambio(usuario.id);
      } catch (error) {
        const publico = errorPublico(error);
        const esReintentable = esFalloDeConectividad(error)
          || error?.name === 'AbortError'
          || error?.code === 'TIMEOUT'
          || error?.status === 401
          || error?.status >= 500;
        if (esReintentable) {
          await actualizarOperacionLocal(operacion.id, usuario.id, { estado: 'pendiente', ultimo_error: publico });
          emitirCambio(usuario.id);
          if (error?.status !== 401) reintento = intentoActual;
          break;
        }
        bloquear(operacion);
        if ([403, 404, 409].includes(error?.status)) {
          await moverOperacionAConflicto(operacion.id, usuario.id, publico);
          emitirCambio(usuario.id);
          continue;
        }
        await actualizarOperacionLocal(operacion.id, usuario.id, { estado: 'error', ultimo_error: publico });
        emitirCambio(usuario.id);
      }
    }
  } finally {
    progresos.delete(usuario.id);
    emitirCambio(usuario.id);
  }
  if (autoRetry && reintento) programarReintento(usuario, reintento);
  else if (!reintento) cancelarReintento(usuario.id);
  return obtenerEstadoCola(usuario.id);
}

export function sincronizarOperacionesPendientes(usuario, opciones = {}) {
  const enviar = opciones.enviar || enviarOperacion;
  const autoRetry = opciones.autoRetry ?? !opciones.enviar;
  if (!usuario?.id) return Promise.resolve({ pendientes: [], conflictos: [] });
  if (sincronizaciones.has(usuario.id)) return sincronizaciones.get(usuario.id);
  const promesa = procesar(usuario, enviar, autoRetry).finally(() => sincronizaciones.delete(usuario.id));
  sincronizaciones.set(usuario.id, promesa);
  return promesa;
}

export async function obtenerEstadoCola(usuarioId) {
  const [operaciones, conflictos, historial] = await Promise.all([
    listarOperacionesLocal(usuarioId),
    listarConflictosLocal(usuarioId),
    listarHistorialSincronizacionLocal(usuarioId),
  ]);
  return {
    operaciones,
    conflictos,
    historial,
    progreso: progresos.get(usuarioId) || null,
    pendientes: operaciones.filter((fila) => ['pendiente', 'sincronizando'].includes(fila.estado)).length,
    bloqueadas: operaciones.filter((fila) => fila.estado === 'bloqueada').length,
    errores: operaciones.filter((fila) => fila.estado === 'error').length,
  };
}

export async function reintentarOperacion(id, usuarioId) {
  const operaciones = await listarOperacionesLocal(usuarioId);
  const operacion = operaciones.find((fila) => fila.id === id);
  if (!operacion) return null;
  // Una bloqueada también puede reintentarse: se reevalúa en la próxima ronda.
  const actualizada = await actualizarOperacionLocal(id, usuarioId, { estado: 'pendiente', ultimo_error: null });
  emitirCambio(usuarioId);
  return actualizada;
}

export async function descartarOperacion(id, usuarioId, { conflicto = false } = {}) {
  if (conflicto) await eliminarConflictoLocal(id, usuarioId);
  else await eliminarOperacionLocal(id, usuarioId);
  emitirCambio(usuarioId);
}

export function suscribirColaOffline(usuarioId, listener) {
  if (typeof window === 'undefined') return () => {};
  const manejar = (evento) => {
    if (String(evento.detail?.usuario_id) === String(usuarioId)) listener();
  };
  window.addEventListener(EVENTO_COLA_OFFLINE, manejar);
  return () => window.removeEventListener(EVENTO_COLA_OFFLINE, manejar);
}

export function _reiniciarSincronizacionParaPruebas() {
  for (const temporizador of temporizadoresReintento.values()) clearTimeout(temporizador);
  sincronizaciones = new Map();
  progresos = new Map();
  temporizadoresReintento = new Map();
}
