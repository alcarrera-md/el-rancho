const { rateLimit } = require('express-rate-limit');

function enteroPositivo(valor, predeterminado) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : predeterminado;
}

function crearLimitadorLogin(env = process.env) {
  const minutos = enteroPositivo(env.AUTH_RATE_LIMIT_WINDOW_MINUTES, 15);
  const limite = enteroPositivo(env.AUTH_RATE_LIMIT_MAX, env.NODE_ENV === 'test' ? 1_000 : 10);
  return rateLimit({
    windowMs: minutos * 60_000,
    limit: limite,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler(req, res) {
      res.status(429).json({ error: { code: 'AUTH_RATE_LIMITED', message: 'No fue posible iniciar sesión. Espera unos minutos e intenta de nuevo.' } });
    },
  });
}

module.exports = { crearLimitadorLogin };
