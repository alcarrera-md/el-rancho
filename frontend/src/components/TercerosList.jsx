import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import NuevoTerceroModal from './NuevoTerceroModal.jsx';
import EditarTerceroModal from './EditarTerceroModal.jsx';
import { mostrarExito } from '../feedbackOperacion.js';
import ModuleHeader from './ModuleHeader.jsx';
import { IconoPersonas } from './Iconos.jsx';

const TIPO_LABEL = { proveedor: 'Proveedor', comprador: 'Comprador', ambos: 'Proveedor y comprador' };

export default function TercerosList() {
  const { usuario } = useAuth();
  const esAdmin = tienePermiso(usuario?.rol, 'terceros', 'crear');

  const [terceros, setTerceros] = useState(null);
  const [error, setError] = useState(null);
  const [mostrarModal, setMostrarModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [tipo, setTipo] = useState('todos');

  function cargar() {
    return api.listarTerceros().then(setTerceros).catch((err) => { setError(err.message); throw err; });
  }
  useEffect(() => { cargar().catch(() => {}); }, []);

  const resumen = useMemo(() => (terceros || []).reduce((acc, tercero) => {
    acc[tercero.tipo] = (acc[tercero.tipo] || 0) + 1;
    return acc;
  }, { proveedor: 0, comprador: 0, ambos: 0 }), [terceros]);
  const visibles = useMemo(() => (terceros || []).filter((tercero) => {
    const coincideTipo = tipo === 'todos' || tercero.tipo === tipo;
    const termino = busqueda.trim().toLocaleLowerCase('es-MX');
    return coincideTipo && (!termino || [tercero.nombre, tercero.contacto, tercero.rfc_nif]
      .some((valor) => String(valor || '').toLocaleLowerCase('es-MX').includes(termino)));
  }), [terceros, busqueda, tipo]);

  return (
    <div>
      <ModuleHeader eyebrow="Relaciones comerciales" title="Proveedores y compradores" description="Personas y empresas con las que el rancho compra, vende o mantiene una relación operativa." icon={IconoPersonas} accent="finanzas" action={esAdmin ? <button className="btn btn-primary" onClick={() => setMostrarModal(true)}>+ Registrar contacto</button> : null} />

      {error && <div className="error-banner">No se pudo conectar con el servidor: {error}</div>}

      <section className="third-party-overview" aria-label="Resumen de relaciones comerciales">
        <button type="button" className={tipo === 'proveedor' ? 'active' : ''} onClick={() => setTipo(tipo === 'proveedor' ? 'todos' : 'proveedor')}><strong>{resumen.proveedor}</strong><span>Proveedores</span><small>Abastecen al rancho</small></button>
        <button type="button" className={tipo === 'comprador' ? 'active' : ''} onClick={() => setTipo(tipo === 'comprador' ? 'todos' : 'comprador')}><strong>{resumen.comprador}</strong><span>Compradores</span><small>Compran ganado o producción</small></button>
        <button type="button" className={tipo === 'ambos' ? 'active' : ''} onClick={() => setTipo(tipo === 'ambos' ? 'todos' : 'ambos')}><strong>{resumen.ambos}</strong><span>Relaciones mixtas</span><small>Compran y proveen</small></button>
      </section>

      <div className="third-party-toolbar">
        <label><span>Buscar contacto</span><input className="input" type="search" value={busqueda} onChange={(evento) => setBusqueda(evento.target.value)} placeholder="Nombre, contacto o RFC…" /></label>
        <label><span>Tipo de relación</span><select value={tipo} onChange={(evento) => setTipo(evento.target.value)}><option value="todos">Todos</option><option value="proveedor">Proveedores</option><option value="comprador">Compradores</option><option value="ambos">Mixtos</option></select></label>
      </div>

      <div className="third-party-list">
        {!terceros ? (
          <div className="empty-state">Cargando...</div>
        ) : terceros.length === 0 ? (
          <div className="empty-state">
            <h3>Todavía no hay proveedores ni compradores registrados</h3>
          </div>
        ) : visibles.length === 0 ? <div className="empty-state"><h3>No hay contactos con estos filtros</h3><p>Prueba otro nombre o muestra todos los tipos de relación.</p></div> : (
          visibles.map((t) => (
            <article className={`third-party-card type-${t.tipo}`} key={t.id}>
              <div className="third-party-avatar" aria-hidden="true">{t.nombre.charAt(0).toUpperCase()}</div>
              <div className="third-party-identity"><span>{TIPO_LABEL[t.tipo] || t.tipo}</span><h2>{t.nombre}</h2><p>{t.contacto || 'Sin teléfono o correo registrado'}</p></div>
              <dl><div><dt>Datos fiscales</dt><dd>{t.rfc_nif || 'Sin RFC / NIF'}</dd></div><div><dt>Información disponible</dt><dd>{t.contacto ? 'Contacto registrado' : 'Completar contacto'}</dd></div></dl>
              <div className="third-party-state"><span>Registro activo</span>{esAdmin && <button className="btn btn-ghost" onClick={() => setEditando(t)}>Editar información</button>}</div>
            </article>
          ))
        )}
      </div>

      {mostrarModal && (
        <NuevoTerceroModal onCerrar={() => setMostrarModal(false)} onCreado={async () => { setMostrarModal(false); await cargar(); mostrarExito({ titulo: 'Tercero registrado correctamente' }); }} />
      )}
      {editando && (
        <EditarTerceroModal tercero={editando} onCerrar={() => setEditando(null)} onGuardado={async () => { setEditando(null); await cargar(); mostrarExito({ titulo: 'Tercero actualizado' }); }} />
      )}
    </div>
  );
}
