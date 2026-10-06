const FUENTES = ['params', 'query', 'body'];

function campoDeIssue(issue) {
  return issue.path.length ? issue.path.join('.') : 'body';
}

function detallesDeError(error) {
  return error.issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        field: [...issue.path, key].join('.'),
        message: 'Propiedad no permitida.',
      }));
    }

    let message = issue.message;
    if (issue.code === 'invalid_type') {
      message = /received undefined/.test(issue.message) ? 'Campo obligatorio.' : 'Tipo de dato incorrecto.';
    }

    return [{ field: campoDeIssue(issue), message }];
  });
}

function responderError(res, details) {
  return res.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Los datos enviados no son válidos.',
      details,
    },
  });
}

function validar(esquemas) {
  return (req, res, next) => {
    const resultados = [];
    const details = [];

    for (const fuente of FUENTES) {
      const esquema = esquemas[fuente];
      if (!esquema) continue;

      const resultado = esquema.safeParse(req[fuente]);
      if (!resultado.success) details.push(...detallesDeError(resultado.error));
      else resultados.push([fuente, resultado.data]);
    }

    if (details.length) return responderError(res, details);

    for (const [fuente, datos] of resultados) {
      if (fuente === 'params' || fuente === 'query') {
        for (const key of Object.keys(req[fuente])) delete req[fuente][key];
        Object.assign(req[fuente], datos);
      } else {
        req[fuente] = datos;
      }
    }

    return next();
  };
}

module.exports = { validar, detallesDeError };
