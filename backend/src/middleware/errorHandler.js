const { AppError, crearError, noEncontrado } = require('../errors');

const DUPLICADOS_CONOCIDOS = {
  animal_arete_id_key: ['ANIMAL_ARETE_DUPLICADO', 'Ya existe un animal con ese arete.'],
  usuario_email_key: ['USUARIO_EMAIL_DUPLICADO', 'Ya existe un usuario con ese correo.'],
  venta_animal_id_key: ['VENTA_ANIMAL_DUPLICADA', 'El animal ya tiene una venta registrada.'],
  compra_animal_animal_id_key: ['COMPRA_ANIMAL_DUPLICADA', 'El animal ya tiene una compra registrada.'],
};

const REGLAS_TRIGGER = [
  [/capacidad máxima/i, 'CORRAL_SIN_CAPACIDAD', 'El corral seleccionado alcanzó su capacidad máxima.'],
  [/no puede ser anterior al nacimiento/i, 'FECHA_ANTERIOR_AL_NACIMIENTO', 'La fecha no puede ser anterior al nacimiento del animal.'],
  [/Stock insuficiente/i, 'STOCK_INSUFICIENTE', 'No hay stock suficiente para realizar la operación.'],
  [/no puede ser futura/i, 'FECHA_FUTURA_NO_PERMITIDA', 'La fecha indicada no puede ser futura.'],
  [/está caducado/i, 'INSUMO_CADUCADO', 'No se puede utilizar un insumo caducado.'],
  [/No se puede reducir la capacidad/i, 'CAPACIDAD_CORRAL_INVALIDA', 'No se puede reducir la capacidad por debajo de la ocupación actual.'],
];

function mapearTrigger(error) {
  if (error.code !== 'P0001') return null;
  const regla = REGLAS_TRIGGER.find(([patron]) => patron.test(error.message || ''));
  if (!regla) return null;
  return crearError(regla[1], regla[2], 409, { cause: error });
}

function mapearPostgres(error) {
  if (!error || typeof error.code !== 'string') return null;

  if (error.code === '23505') {
    const conocido = DUPLICADOS_CONOCIDOS[error.constraint];
    return crearError(
      conocido?.[0] || 'DUPLICATE_RESOURCE',
      conocido?.[1] || 'Ya existe un registro con los datos proporcionados.',
      409,
      { cause: error }
    );
  }

  if (error.code === '23503') {
    return crearError(
      'INVALID_REFERENCE',
      'Uno de los recursos relacionados no existe o no puede eliminarse porque está en uso.',
      409,
      { cause: error }
    );
  }

  if (error.code === '23514') {
    return crearError(
      'DATA_CONSTRAINT_ERROR',
      'Los datos no cumplen las restricciones requeridas.',
      422,
      { cause: error }
    );
  }

  return mapearTrigger(error);
}

function normalizarError(error) {
  if (error instanceof AppError) return error;

  const postgres = mapearPostgres(error);
  if (postgres) return postgres;

  if (error?.type === 'entity.parse.failed') {
    return crearError('INVALID_JSON', 'El cuerpo de la solicitud no contiene JSON válido.', 400, { cause: error });
  }

  if (error?.code === 'LIMIT_FILE_SIZE') {
    return crearError('FILE_TOO_LARGE', 'El archivo excede el tamaño permitido.', 413, { cause: error });
  }

  if (/Solo se permiten imágenes/i.test(error?.message || '')) {
    return crearError('INVALID_FILE_TYPE', 'Solo se permiten archivos de imagen.', 400, { cause: error });
  }

  return crearError(
    'INTERNAL_ERROR',
    'Ocurrió un error interno. Intenta nuevamente más tarde.',
    500,
    { cause: error }
  );
}

function mensajePublicoError(error) {
  return normalizarError(error).message;
}

function serializarError(error) {
  const respuesta = {
    code: error.code,
    message: error.message,
  };
  if (error.details !== undefined) respuesta.details = error.details;
  return { error: respuesta };
}

function datosInternos(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    constraint: error.constraint,
    detail: error.detail,
    stack: error.stack,
  };
}

function crearManejadorErrores(logger = console) {
  return (errorOriginal, req, res, next) => {
    if (res.headersSent) return next(errorOriginal);

    const error = normalizarError(errorOriginal);
    const causa = error.cause || (error === errorOriginal ? undefined : errorOriginal);
    if (error.status >= 500 || causa) {
      logger.error('[backend-error]', {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl,
        status: error.status,
        publicCode: error.code,
        internal: datosInternos(causa),
      });
    }

    return res.status(error.status).json(serializarError(error));
  };
}

const CODIGOS_404 = [
  [/animal/i, 'ANIMAL_NO_ENCONTRADO'],
  [/corral/i, 'CORRAL_NO_ENCONTRADO'],
  [/insumo/i, 'INSUMO_NO_ENCONTRADO'],
  [/usuario/i, 'USUARIO_NO_ENCONTRADO'],
  [/trabajador/i, 'TRABAJADOR_NO_ENCONTRADO'],
  [/tercero/i, 'TERCERO_NO_ENCONTRADO'],
  [/tarea/i, 'TAREA_NO_ENCONTRADA'],
  [/plan/i, 'PLAN_NO_ENCONTRADO'],
];

function codigoLegacy(status, message) {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'AUTHENTICATION_ERROR';
  if (status === 403) return 'AUTHORIZATION_ERROR';
  if (status === 404) return CODIGOS_404.find(([patron]) => patron.test(message))?.[1] || 'RESOURCE_NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'UNPROCESSABLE_ENTITY';
  if (status >= 500) return status === 502 ? 'EXTERNAL_SERVICE_ERROR' : 'INTERNAL_ERROR';
  return 'REQUEST_ERROR';
}

function normalizarRespuestasLegacy(req, res, next) {
  const jsonOriginal = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && typeof body?.error === 'string') {
      const status = res.statusCode;
      const esErrorServidor = status >= 500;
      const message = esErrorServidor
        ? (status === 502
          ? 'No fue posible completar la solicitud con el servicio externo.'
          : 'Ocurrió un error interno. Intenta nuevamente más tarde.')
        : body.error;
      return jsonOriginal({ error: { code: codigoLegacy(status, body.error), message } });
    }
    return jsonOriginal(body);
  };
  next();
}

function rutaNoEncontrada(req, res, next) {
  next(noEncontrado('ROUTE_NOT_FOUND', 'La ruta solicitada no existe.'));
}

module.exports = {
  crearManejadorErrores,
  mapearPostgres,
  mensajePublicoError,
  normalizarError,
  normalizarRespuestasLegacy,
  rutaNoEncontrada,
  serializarError,
};
