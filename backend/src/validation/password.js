const { z } = require('./comun');

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 72;
const passwordNueva = z.string()
  .min(PASSWORD_MIN, `Debe tener al menos ${PASSWORD_MIN} caracteres.`)
  .max(PASSWORD_MAX, `No debe exceder ${PASSWORD_MAX} caracteres.`);

module.exports = { PASSWORD_MIN, PASSWORD_MAX, passwordNueva };
