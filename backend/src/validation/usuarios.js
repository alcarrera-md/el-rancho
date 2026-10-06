const { z } = require('./comun');
const { passwordNueva } = require('./password');

const idPositivo = z.coerce.number().int().positive();
const email = z.string().trim().toLowerCase().email('Debe ser un correo electrónico válido.').max(254);

const crearUsuario = z.strictObject({
  nombre: z.string().trim().min(1, 'Campo obligatorio.').max(150),
  email,
  password: passwordNueva,
  rol_id: idPositivo,
  trabajador_id: z.union([idPositivo, z.literal(''), z.null()]).optional().transform((valor) => valor || null),
});

const restablecerPassword = z.strictObject({ password: passwordNueva });

module.exports = { crearUsuario, restablecerPassword };
