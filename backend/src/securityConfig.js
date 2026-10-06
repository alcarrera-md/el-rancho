const MIN_JWT_SECRET_LENGTH = 32;

function validarJwtSecret(env = process.env) {
  const secreto = String(env.JWT_SECRET || '');
  if (secreto.length < MIN_JWT_SECRET_LENGTH || /reemplaza|cambiaesta|secret$/i.test(secreto)) {
    throw new Error(`JWT_SECRET debe ser aleatorio y tener al menos ${MIN_JWT_SECRET_LENGTH} caracteres.`);
  }
  return secreto;
}

function origenesCors(env = process.env) {
  return String(env.CORS_ORIGINS || '').split(',').map((valor) => valor.trim()).filter(Boolean);
}

function esOrigenDesarrolloSeguro(origen) {
  try {
    const url = new URL(origen);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname;
    return host === 'localhost' || host === '127.0.0.1'
      || /^10\./.test(host) || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch {
    return false;
  }
}

function crearOpcionesCors(env = process.env) {
  const permitidos = new Set(origenesCors(env));
  const desarrollo = env.NODE_ENV !== 'production';
  return {
    origin(origen, callback) {
      if (!origen || permitidos.has(origen) || (desarrollo && esOrigenDesarrolloSeguro(origen))) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  };
}

module.exports = { MIN_JWT_SECRET_LENGTH, crearOpcionesCors, esOrigenDesarrolloSeguro, origenesCors, validarJwtSecret };
