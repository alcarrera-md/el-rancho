import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import CampoPassword from './CampoPassword.jsx';
import { FeedbackOperacion } from './EstadosUI.jsx';
import { PASSWORD_MAX, PASSWORD_MIN } from '../passwordSecurity.js';
import FortalezaPassword from './FortalezaPassword.jsx';
import ModuleHeader from './ModuleHeader.jsx';

function fechaCuenta(valor) {
  return valor ? new Date(valor).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin registro';
}

export default function Perfil() {
  const { usuario, cerrarSesion } = useAuth();
  const navigate = useNavigate();
  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNuevo, setPasswordNuevo] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function cambiarPassword(evento) {
    evento.preventDefault();
    if (passwordNuevo !== confirmacion) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    if (passwordNuevo.length < PASSWORD_MIN || passwordNuevo.length > PASSWORD_MAX) {
      setError(`La nueva contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres.`);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await api.cambiarPasswordPropio(passwordActual, passwordNuevo);
      setPasswordActual('');
      setPasswordNuevo('');
      setConfirmacion('');
      await cerrarSesion({ forzar: true, preservarOperaciones: true });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function salir() {
    if (!(await cerrarSesion())) return;
    navigate('/', { replace: true });
  }

  return (
    <div className="profile-page">
      <ModuleHeader eyebrow="Cuenta personal" title="Tu cuenta" description="Identidad, acceso y seguridad de tu cuenta." action={<div className="profile-header-actions"><button type="button" className="btn btn-secondary" onClick={() => navigate('/configuracion/sincronizacion')}>Sincronización</button><button type="button" className="btn btn-ghost" onClick={() => navigate('/configuracion/apariencia')}>Personalizar apariencia</button></div>} />

      <section className="profile-summary card" aria-labelledby="profile-name">
        <div className="profile-avatar" aria-hidden="true">{usuario?.nombre?.trim()?.charAt(0)?.toUpperCase() || 'U'}</div>
        <div className="profile-identity"><h2 id="profile-name">{usuario?.nombre}</h2><p>{usuario?.email}</p><span className="pill pill-chip">{usuario?.rol}</span></div>
        <div className="profile-access"><span className={`status-dot ${usuario?.activo === false ? 'inactive' : ''}`} />{usuario?.activo === false ? 'Acceso inactivo' : 'Acceso activo'}</div>
      </section>

      <div className="profile-grid">
        <section className="card profile-card">
          <h2>Información de la cuenta</h2>
          <dl className="profile-details">
            <div><dt>Nombre</dt><dd>{usuario?.nombre}</dd></div>
            <div><dt>Correo</dt><dd>{usuario?.email}</dd></div>
            <div><dt>Rol</dt><dd>{usuario?.rol}</dd></div>
            <div><dt>Cuenta creada</dt><dd>{fechaCuenta(usuario?.creado_en)}</dd></div>
            <div><dt>Último acceso</dt><dd>{fechaCuenta(usuario?.ultimo_login)}</dd></div>
            <div><dt>Trabajador vinculado</dt><dd>{usuario?.trabajador_nombre || 'Sin trabajador vinculado'}{usuario?.trabajador_telefono ? ` · ${usuario.trabajador_telefono}` : ''}</dd></div>
          </dl>
        </section>

        <section className="card profile-card">
          <h2>Cambiar mi contraseña</h2>
          <p className="profile-help">Confirma tu contraseña actual. El sistema nunca muestra ni recupera contraseñas almacenadas.</p>
          {error && <FeedbackOperacion tipo="error" mensaje={error} />}
          <form onSubmit={cambiarPassword}>
            <CampoPassword label="Contraseña actual" value={passwordActual} onChange={(e) => setPasswordActual(e.target.value)} required autoComplete="current-password" />
            <CampoPassword label="Nueva contraseña" value={passwordNuevo} onChange={(e) => setPasswordNuevo(e.target.value)} required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} ayuda="Usa una frase larga de entre 12 y 72 caracteres." />
            <FortalezaPassword password={passwordNuevo} />
            <CampoPassword label="Confirmar nueva contraseña" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} />
            <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Actualizando…' : 'Actualizar contraseña'}</button>
          </form>
        </section>
      </div>

      <section className="profile-session card"><div><h2>Sesión actual</h2><p>Cierra tu sesión al terminar, especialmente en un dispositivo compartido.</p></div><button type="button" className="btn btn-ghost" onClick={salir}>Cerrar sesión</button></section>
    </div>
  );
}
