const AppError = require('./AppError');

function crearError(code, message, status, options = {}) {
  return new AppError({ code, message, status, ...options });
}

function autenticacion(message = 'Debes iniciar sesión para realizar esta acción.', options) {
  return crearError('AUTHENTICATION_ERROR', message, 401, options);
}

function autorizacion(message = 'No tienes permiso para realizar esta acción.', options) {
  return crearError('AUTHORIZATION_ERROR', message, 403, options);
}

function noEncontrado(code = 'RESOURCE_NOT_FOUND', message = 'No se encontró el recurso solicitado.', options) {
  return crearError(code, message, 404, options);
}

function conflicto(code = 'CONFLICT', message = 'La operación no puede realizarse.', options) {
  return crearError(code, message, 409, options);
}

function integracion(code = 'EXTERNAL_SERVICE_ERROR', message = 'No fue posible completar la solicitud con el servicio externo.', cause) {
  return crearError(code, message, 502, { cause });
}

module.exports = {
  AppError,
  crearError,
  autenticacion,
  autorizacion,
  noEncontrado,
  conflicto,
  integracion,
};
