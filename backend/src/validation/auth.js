const { z } = require('./comun');
const { passwordNueva } = require('./password');

const login = z.strictObject({
  email: z.string().trim().toLowerCase().min(1, 'Campo obligatorio.').email('Debe ser un correo electrónico válido.').max(254),
  password: z.string().min(1, 'Campo obligatorio.').max(200, 'No debe exceder 200 caracteres.'),
});

const cambiarPassword = z.strictObject({
  password_actual: z.string().min(1, 'Campo obligatorio.').max(200, 'No debe exceder 200 caracteres.'),
  password_nuevo: passwordNueva,
});

module.exports = { cambiarPassword, login };
