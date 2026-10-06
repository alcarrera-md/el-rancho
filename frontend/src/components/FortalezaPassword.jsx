import { evaluarFortalezaPassword } from '../passwordSecurity.js';

export default function FortalezaPassword({ password }) {
  const fortaleza = evaluarFortalezaPassword(password);
  return (
    <div className="password-strength" aria-live="polite">
      <div className="password-strength-track" aria-hidden="true"><span style={{ width: `${fortaleza.porcentaje}%` }} /></div>
      <small><strong>Fortaleza: {fortaleza.nivel}.</strong> {fortaleza.mensaje}</small>
    </div>
  );
}
