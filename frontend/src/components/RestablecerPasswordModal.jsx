import { useState } from 'react';
import { api } from '../api';
import CampoPassword from './CampoPassword.jsx';
import { generarPasswordSegura } from '../credenciales.js';
import { PASSWORD_MAX, PASSWORD_MIN } from '../passwordSecurity.js';
import FortalezaPassword from './FortalezaPassword.jsx';

export default function RestablecerPasswordModal({ usuarioId, nombre, onCerrar, onListo }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e) {
    e.preventDefault();
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      setError(`La contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres.`);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await api.restablecerPassword(usuarioId, password);
      onListo();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Restablecer contraseña de {nombre}</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <CampoPassword label="Nueva contraseña" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} ayuda="La persona podrá usarla inmediatamente para iniciar sesión." />
          <FortalezaPassword password={password} />
          <button type="button" className="btn btn-ghost generate-password" onClick={() => setPassword(generarPasswordSegura())}>Generar contraseña segura</button>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Restablecer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
