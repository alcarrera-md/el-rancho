import { useState } from 'react';
import { api } from '../api';
import ModalAccesible from './ModalAccesible.jsx';

export default function EditarUsuarioModal({ usuario, onCerrar, onGuardado }) {
  const [nombre, setNombre] = useState(usuario.nombre);
  const [email, setEmail] = useState(usuario.email);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  async function guardar(evento) {
    evento.preventDefault();
    if (!nombre.trim() || !email.trim()) { setError('Nombre y correo son obligatorios.'); return; }
    setGuardando(true);
    setError('');
    try {
      await api.actualizarUsuario(usuario.id, { nombre: nombre.trim(), email: email.trim() });
      onGuardado();
    } catch (err) { setError(err.message); } finally { setGuardando(false); }
  }
  return (
    <ModalAccesible titulo={`Editar cuenta de ${usuario.nombre}`} onCerrar={onCerrar} ocupado={guardando}>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={guardar}>
        <div className="field"><label htmlFor="editar-usuario-nombre">Nombre</label><input id="editar-usuario-nombre" className="input" required value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="field"><label htmlFor="editar-usuario-email">Correo</label><input id="editar-usuario-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="modal-actions"><button type="button" className="btn btn-ghost" data-modal-cerrar onClick={onCerrar}>Cancelar</button><button className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button></div>
      </form>
    </ModalAccesible>
  );
}
