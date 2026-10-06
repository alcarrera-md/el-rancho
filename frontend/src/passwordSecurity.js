export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 72;

export function evaluarFortalezaPassword(password = '') {
  const longitud = [...password].length;
  if (!longitud) return { nivel: 'vacía', porcentaje: 0, mensaje: 'Usa una frase de contraseña larga y fácil de recordar.' };
  if (longitud < PASSWORD_MIN) return { nivel: 'insuficiente', porcentaje: Math.max(15, Math.round((longitud / PASSWORD_MIN) * 55)), mensaje: `Faltan ${PASSWORD_MIN - longitud} caracteres para el mínimo.` };
  if (longitud < 16) return { nivel: 'adecuada', porcentaje: 70, mensaje: 'Cumple el mínimo. Una frase más larga ofrece mayor protección.' };
  if (longitud < 24) return { nivel: 'fuerte', porcentaje: 88, mensaje: 'Buena longitud para una contraseña personal.' };
  return { nivel: 'muy fuerte', porcentaje: 100, mensaje: 'Excelente longitud. Guárdala en un administrador de contraseñas.' };
}
