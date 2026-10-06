import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import CampoPassword from './CampoPassword.jsx';
import { esFalloDeConectividad } from '../offline/connectivity.js';

export default function Login() {
  const { avisoAuth, iniciarSesion } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [entrando, setEntrando] = useState(false);

  async function manejarSubmit(e) {
    e.preventDefault();
    setError(null);
    setEntrando(true);
    try {
      await iniciarSesion(email, password);
    } catch (err) {
      // Iniciar sesión siempre requiere al servidor: nunca se valida una
      // contraseña ni se crea una sesión nueva sin conexión.
      setError(esFalloDeConectividad(err) ? 'Conéctate para iniciar sesión por primera vez en este dispositivo.' : err.message);
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--pasture-dark)', padding: 20,
    }}>
      <div className="card" style={{ padding: 36, width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <h1 style={{ fontSize: '1.6rem' }}>El Rancho</h1>
          <div className="subtitle">Registro Ganadero</div>
        </div>
        {avisoAuth && <div className="status-banner" role="status">{avisoAuth}</div>}
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={manejarSubmit}>
          <div className="field">
            <label>Correo</label>
            <input className="input" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <CampoPassword label="Contraseña" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={entrando}>
            {entrando ? 'Entrando...' : 'Iniciar sesión'}
          </button>
        </form>
      </div>
    </div>
  );
}
