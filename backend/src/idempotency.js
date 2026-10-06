const crypto = require('node:crypto');
const { sanitizar } = require('./bitacora');
const { enTransaccion } = require('./transaction');
const { conflicto, crearError } = require('./errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FECHA_ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/i;

function errorContrato(code, message, field) {
  return crearError(code, message, 400, {
    details: field ? [{ field, message }] : undefined,
  });
}

function header(req, nombre) {
  const valor = req.headers[nombre];
  if (valor === undefined) return null;
  if (typeof valor !== 'string') throw errorContrato('INVALID_OFFLINE_METADATA', 'La metadata offline no es válida.', nombre);
  return valor.trim();
}

function fechaIsoValida(valor) {
  return FECHA_ISO_CON_ZONA.test(valor) && !Number.isNaN(Date.parse(valor));
}

function contextoIdempotencia(req) {
  const marcaOffline = header(req, 'x-offline-operation');
  if (marcaOffline && !['true', 'false'].includes(marcaOffline.toLowerCase())) {
    throw errorContrato('INVALID_OFFLINE_METADATA', 'X-Offline-Operation debe ser true o false.', 'x-offline-operation');
  }
  const offline = marcaOffline?.toLowerCase() === 'true';
  const clientOperationId = header(req, 'idempotency-key');
  const dispositivoId = header(req, 'x-client-installation-id');
  const fechaLocal = header(req, 'x-client-local-timestamp');

  if (offline && !clientOperationId) {
    throw errorContrato('IDEMPOTENCY_KEY_REQUIRED', 'La operación offline requiere Idempotency-Key.', 'idempotency-key');
  }
  if (!clientOperationId) return { habilitada: false, offline };
  if (!UUID.test(clientOperationId)) {
    throw errorContrato('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key debe ser un UUID válido.', 'idempotency-key');
  }
  if (offline && !dispositivoId) {
    throw errorContrato('INSTALLATION_ID_REQUIRED', 'La operación offline requiere identificar la instalación.', 'x-client-installation-id');
  }
  if (dispositivoId && !UUID.test(dispositivoId)) {
    throw errorContrato('INVALID_INSTALLATION_ID', 'El identificador de instalación debe ser un UUID válido.', 'x-client-installation-id');
  }
  if (fechaLocal && !fechaIsoValida(fechaLocal)) {
    throw errorContrato('INVALID_LOCAL_TIMESTAMP', 'La fecha local debe incluir fecha, hora y zona horaria.', 'x-client-local-timestamp');
  }

  return {
    habilitada: true,
    offline,
    clientOperationId: clientOperationId.toLowerCase(),
    dispositivoId: dispositivoId?.toLowerCase() || null,
    fechaLocal: fechaLocal ? new Date(fechaLocal) : null,
  };
}

function normalizar(valor) {
  if (Array.isArray(valor)) return valor.map(normalizar);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.keys(valor).sort().map((clave) => [clave, normalizar(valor[clave])])
    );
  }
  return valor;
}

function hashPayload(tipo, entidad, payload) {
  const canonico = JSON.stringify(normalizar({ tipo, entidad, payload }));
  return crypto.createHash('sha256').update(canonico, 'utf8').digest('hex');
}

function verificarRecibo(recibo, { tipo, entidad, payloadHash }) {
  const mismoContrato = recibo.tipo === tipo
    && recibo.entidad === entidad
    && recibo.payload_hash.trim() === payloadHash;
  if (!mismoContrato) {
    throw conflicto(
      'IDEMPOTENCY_KEY_REUSED',
      'La clave de idempotencia ya fue utilizada con datos diferentes.'
    );
  }
  if (recibo.estado !== 'aplicada') {
    throw conflicto('IDEMPOTENCY_OPERATION_IN_PROGRESS', 'La operación todavía está siendo procesada.');
  }
}

async function ejecutarIdempotente(req, opciones, operacion) {
  const contexto = contextoIdempotencia(req);
  const estadoHttp = opciones.httpStatus || 200;

  return enTransaccion(async (client) => {
    if (!contexto.habilitada) {
      const resultado = await operacion(client, contexto);
      return { resultado, estadoHttp, repetida: false, idempotente: false };
    }

    const payloadHash = hashPayload(opciones.tipo, opciones.entidad, opciones.payload);
    const reserva = await client.query(
      `INSERT INTO operacion_cliente
       (usuario_id, client_operation_id, tipo, entidad, payload_hash,
        fecha_local_reportada, dispositivo_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (usuario_id, client_operation_id) DO NOTHING
       RETURNING *`,
      [req.usuario.id, contexto.clientOperationId, opciones.tipo, opciones.entidad,
        payloadHash, contexto.fechaLocal, contexto.dispositivoId]
    );

    if (!reserva.rowCount) {
      const existente = await client.query(
        `SELECT * FROM operacion_cliente
         WHERE usuario_id = $1 AND client_operation_id = $2`,
        [req.usuario.id, contexto.clientOperationId]
      );
      verificarRecibo(existente.rows[0], { tipo: opciones.tipo, entidad: opciones.entidad, payloadHash });
      return {
        resultado: existente.rows[0].resultado_publico,
        estadoHttp: existente.rows[0].http_status,
        repetida: true,
        idempotente: true,
      };
    }

    const resultado = await operacion(client, contexto);
    const resultadoPublico = sanitizar(
      opciones.resultadoPublico ? opciones.resultadoPublico(resultado) : resultado
    );
    const entidadId = opciones.entidadId ? opciones.entidadId(resultado) : resultado?.id;
    await client.query(
      `UPDATE operacion_cliente
       SET estado = 'aplicada', entidad_id = $1, resultado_publico = $2,
           http_status = $3, fecha_aplicada = clock_timestamp()
       WHERE id = $4`,
      [entidadId || null, resultadoPublico || {}, estadoHttp, reserva.rows[0].id]
    );
    return { resultado: resultadoPublico, estadoHttp, repetida: false, idempotente: true };
  });
}

const RUTA_REFERENCIA = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*){0,4}$/i;
const MAX_REFERENCIAS = 10;

function esReferencia(valor) {
  return Boolean(valor && typeof valor === 'object' && !Array.isArray(valor) && Object.hasOwn(valor, '$op'));
}

function leerRuta(objeto, ruta) {
  return ruta.split('.').reduce((actual, clave) => (actual && typeof actual === 'object' && Object.hasOwn(actual, clave) ? actual[clave] : undefined), objeto);
}

// P8: una captura offline puede apuntar al resultado de otra captura previa
// que todavía no tenía ID real (p. ej. el ciclo que creará un servicio).
// Forma: { "$op": "<client_operation_id>", "ruta": "ciclo.id" }. Se resuelve
// solo contra recibos APLICADOS del mismo usuario, dentro de la transacción
// de la operación que depende de ellos. El payload original (con la
// referencia) es el que se usa para el hash de idempotencia.
async function resolverReferenciasOperacion(client, usuarioId, payload) {
  const referencias = [];
  const recolectar = (valor) => {
    if (esReferencia(valor)) { referencias.push(valor); return; }
    if (Array.isArray(valor)) valor.forEach(recolectar);
    else if (valor && typeof valor === 'object') Object.values(valor).forEach(recolectar);
  };
  recolectar(payload);
  if (!referencias.length) return payload;
  if (referencias.length > MAX_REFERENCIAS) throw errorContrato('DEPENDENCIA_INVALIDA', 'La captura tiene demasiadas dependencias.');
  for (const referencia of referencias) {
    const claves = Object.keys(referencia).sort().join(',');
    if (claves !== '$op,ruta' || typeof referencia.$op !== 'string' || !UUID.test(referencia.$op)
      || typeof referencia.ruta !== 'string' || !RUTA_REFERENCIA.test(referencia.ruta)) {
      throw errorContrato('DEPENDENCIA_INVALIDA', 'La referencia a una captura anterior no es válida.');
    }
  }
  const ids = [...new Set(referencias.map((referencia) => referencia.$op.toLowerCase()))];
  const { rows } = await client.query(
    `SELECT client_operation_id::text AS id, resultado_publico
     FROM operacion_cliente
     WHERE usuario_id = $1 AND client_operation_id = ANY($2::uuid[]) AND estado = 'aplicada'`,
    [usuarioId, ids]
  );
  const recibos = new Map(rows.map((fila) => [fila.id.toLowerCase(), fila.resultado_publico]));
  const faltantes = ids.filter((id) => !recibos.has(id));
  if (faltantes.length) {
    throw conflicto('DEPENDENCIA_NO_APLICADA', 'La captura depende de otra que no llegó a El Rancho.', {
      details: faltantes.map((id) => ({ field: 'depende_de', message: 'Captura anterior no aplicada.', operacion: id })),
    });
  }
  const reemplazar = (valor) => {
    if (esReferencia(valor)) {
      const resuelto = leerRuta(recibos.get(valor.$op.toLowerCase()), valor.ruta);
      if (resuelto === undefined || resuelto === null || typeof resuelto === 'object') {
        throw errorContrato('DEPENDENCIA_INVALIDA', 'La captura anterior no produjo el dato requerido.', 'depende_de');
      }
      return resuelto;
    }
    if (Array.isArray(valor)) return valor.map(reemplazar);
    if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([clave, contenido]) => [clave, reemplazar(contenido)]));
    return valor;
  };
  return reemplazar(payload);
}

function responderIdempotente(res, ejecucion) {
  if (ejecucion.idempotente) {
    res.set('Idempotency-Replayed', ejecucion.repetida ? 'true' : 'false');
  }
  return res.status(ejecucion.estadoHttp).json(ejecucion.resultado);
}

module.exports = {
  contextoIdempotencia,
  ejecutarIdempotente,
  hashPayload,
  resolverReferenciasOperacion,
  responderIdempotente,
};
