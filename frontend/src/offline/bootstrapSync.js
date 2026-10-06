// Offline v1 Fase B §4 — orquesta la sincronización online: valida el
// contrato de GET /api/sync/bootstrap y arma el snapshot local completo
// en memoria ANTES de tocar IndexedDB. Solo si todo lo anterior tuvo
// éxito se abre la única transacción atómica de escritura
// (guardarBootstrapLocal) — así, cualquier falla de red o de contrato
// ocurre antes de escribir nada, y el snapshot anterior queda intacto
// sin necesitar lógica de rollback aparte.
import { api, getToken } from '../api.js';
import { decodificarJWT } from './jwt.js';
import { calcularExpiracionVentanaOffline } from './sessionWindow.js';
import { obtenerInstalacionId } from './instalacion.js';
import { guardarBootstrapLocal, CAMPO_DB_VERSION } from './campoDB.js';

export const ESQUEMA_BOOTSTRAP_ESPERADO = 'offline-bootstrap.v5';
// v3 se sigue aceptando para no perder el snapshot si el frontend se
// actualiza antes que el servidor; sus animales simplemente traen menos campos.
const ESQUEMAS_COMPATIBLES = new Set(['offline-bootstrap.v3', 'offline-bootstrap.v4', ESQUEMA_BOOTSTRAP_ESPERADO]);

export class ContratoBootstrapInvalidoError extends Error {
  constructor(motivo) {
    super(`Respuesta de /api/sync/bootstrap no cumple el contrato esperado: ${motivo}`);
    this.name = 'ContratoBootstrapInvalidoError';
  }
}

export function validarContratoBootstrap(payload, usuarioIdEsperado) {
  if (!payload || typeof payload !== 'object') throw new ContratoBootstrapInvalidoError('respuesta vacía');
  if (!ESQUEMAS_COMPATIBLES.has(payload.schema)) throw new ContratoBootstrapInvalidoError(`schema "${payload.schema}"`);
  if (!payload.server_timestamp || Number.isNaN(new Date(payload.server_timestamp).getTime())) {
    throw new ContratoBootstrapInvalidoError('server_timestamp inválido');
  }
  if (!payload.partition?.usuario_id) throw new ContratoBootstrapInvalidoError('falta partition.usuario_id');
  if (usuarioIdEsperado && String(payload.partition.usuario_id) !== String(usuarioIdEsperado)) {
    throw new ContratoBootstrapInvalidoError('partition.usuario_id no coincide con la sesión activa');
  }
  if (!payload.usuario || String(payload.usuario.id) !== String(payload.partition.usuario_id)) {
    throw new ContratoBootstrapInvalidoError('usuario no coincide con la partición');
  }
  if (payload.usuario.sesion_version !== payload.partition.sesion_version) {
    throw new ContratoBootstrapInvalidoError('sesion_version no coincide con la partición');
  }
  if (!Array.isArray(payload.animales) || !Array.isArray(payload.corrales) || !Array.isArray(payload.tareas) || !Array.isArray(payload.insumos)) {
    throw new ContratoBootstrapInvalidoError('animales/corrales/tareas/insumos deben ser arreglos');
  }
  return payload;
}

/**
 * `usuarioMe` es la respuesta ya validada de GET /api/auth/me (misma
 * petición que AuthContext ya hace al refrescar sesión online). Devuelve
 * el snapshot de sesión recién guardado, listo para usarse en memoria sin
 * tener que releerlo de IndexedDB.
 */
export function construirBootstrapLocal(payloadSinValidar, usuarioMe, { token = getToken(), instalacionId = obtenerInstalacionId() } = {}) {
  const payload = validarContratoBootstrap(payloadSinValidar, usuarioMe.id);
  const claims = decodificarJWT(token);
  if (!claims?.id || String(claims.id) !== String(usuarioMe.id) || !claims.expiraEn) {
    throw new ContratoBootstrapInvalidoError('no se conoce un JWT vigente para esta sesión');
  }
  const validadoEn = new Date(payload.server_timestamp).toISOString();
  // 72 h de uso local desde esta validación online (ver sessionWindow.js);
  // el vencimiento del JWT se guarda aparte y solo afecta a sincronizar.
  const ventanaOfflineExpiraEn = calcularExpiracionVentanaOffline(validadoEn);

  const sesion = {
    nombre: payload.usuario.nombre,
    email: payload.usuario.email,
    rol: payload.usuario.rol,
    trabajador: payload.usuario.trabajador || null,
    sesion_version: payload.usuario.sesion_version,
    ultima_validacion_online: validadoEn,
    jwt_expira_en: claims.expiraEn,
    ventana_offline_expira_en: ventanaOfflineExpiraEn,
    version_bootstrap: payload.schema,
  };
  const coleccion = (datos) => ({ datos, version_bootstrap: payload.schema, sincronizado_en: payload.server_timestamp });
  const metadatos = {
    instalacion_id: instalacionId,
    propietario_usuario_id: usuarioMe.id,
    ultima_sincronizacion_exitosa: validadoEn,
    server_timestamp: payload.server_timestamp,
    snapshot_version: Number(payload.snapshot_version) || 3,
    snapshot_generado_en: payload.generado_en || payload.server_timestamp,
    version_esquema_local: CAMPO_DB_VERSION,
  };

  return {
    usuarioId: usuarioMe.id,
    contenido: {
      sesion,
      animales: coleccion(payload.animales),
      corrales: coleccion(payload.corrales),
      tareas: coleccion(payload.tareas),
      // v5: vacunas y medicamentos viajan en la misma fila del catálogo de
      // insumos (sin almacén nuevo); v3/v4 simplemente no los traen.
      insumos: { ...coleccion(payload.insumos), sanitarios: Array.isArray(payload.insumos_sanitarios) ? payload.insumos_sanitarios : [] },
      metadatos,
    },
  };
}

export async function sincronizarBootstrap(usuarioMe) {
  const preparado = construirBootstrapLocal(await api.bootstrapSync(), usuarioMe);
  await guardarBootstrapLocal(preparado.usuarioId, preparado.contenido);

  return { ...preparado.contenido.sesion, usuario_id: preparado.usuarioId };
}
