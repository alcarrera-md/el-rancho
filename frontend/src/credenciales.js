import { PASSWORD_MIN } from './passwordSecurity.js';

const CARACTERES_SEGUROS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function enteroSeguro(maximo) {
  const valores = new Uint32Array(1);
  crypto.getRandomValues(valores);
  return valores[0] % maximo;
}

export function generarPasswordSegura(longitud = 12) {
  const base = ['A', 'a', '7'];
  while (base.length < Math.max(PASSWORD_MIN, longitud)) base.push(CARACTERES_SEGUROS[enteroSeguro(CARACTERES_SEGUROS.length)]);
  for (let i = base.length - 1; i > 0; i -= 1) {
    const j = enteroSeguro(i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join('');
}
