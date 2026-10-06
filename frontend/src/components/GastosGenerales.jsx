import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import RegistrarGastoModal from './RegistrarGastoModal.jsx';
import { mostrarExito } from '../feedbackOperacion.js';
import { actualizarContexto, crearRutaContextual } from '../navigationContext.js';
import ModuleHeader from './ModuleHeader.jsx';

function formatearFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function GastosGenerales() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [parametros, setParametros] = useSearchParams();
  const esAdmin = tienePermiso(usuario?.rol, 'gastos_generales', 'crear');

  const [gastos, setGastos] = useState(null);
  const [error, setError] = useState(null);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(parametros.get('desde') || '') ? parametros.get('desde') : '';
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(parametros.get('hasta') || '') ? parametros.get('hasta') : '';
  const [mostrarModal, setMostrarModal] = useState(false);
  const [editando, setEditando] = useState(null);

  function cargar() {
    const params = {};
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    return api.listarGastos(params).then(setGastos).catch((err) => { setError(err.message); throw err; });
  }
  useEffect(() => {
    cargar().catch(() => {});
    // El efecto no debe devolver la promesa: React la interpretaría como cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  const total = gastos ? gastos.reduce((s, g) => s + Number(g.monto), 0) : 0;

  function cambiarFecha(clave, valor) {
    setParametros(actualizarContexto(parametros, { [clave]: valor }), { replace: true });
  }

  return (
    <div>
      <ModuleHeader eyebrow="Control financiero" title="En qué está gastando el rancho" description="Revisa gastos generales como veterinario, electricidad, combustible y mano de obra." accent="finanzas" action={esAdmin ? <button className="btn btn-primary" onClick={() => setMostrarModal(true)}>+ Registrar gasto</button> : null} />

      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Desde</label>
          <input className="input" type="date" value={desde} onChange={(e) => cambiarFecha('desde', e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Hasta</label>
          <input className="input" type="date" value={hasta} onChange={(e) => cambiarFecha('hasta', e.target.value)} />
        </div>
      </div>

      {gastos && (
        <div className="resumen-grid" style={{ gridTemplateColumns: '1fr', marginBottom: 20 }}>
          <div className="card resumen-item">
            <div className="valor">${total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</div>
            <div className="etiqueta">Total en el periodo</div>
            <button type="button" className="btn btn-ghost" onClick={() => navigate(crearRutaContextual('/rentabilidad', { desde, hasta }))}>Ver impacto en Rentabilidad</button>
          </div>
        </div>
      )}

      <div className="card">
        {!gastos ? (
          <div className="empty-state">Cargando...</div>
        ) : gastos.length === 0 ? (
          <div className="empty-state">
            <h3>No hay gastos registrados en este periodo</h3>
          </div>
        ) : (
          <table className="animal-table">
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Monto</th><th>Corral</th><th>Descripción</th><th></th></tr></thead>
            <tbody>
              {gastos.map((g) => (
                <tr key={g.id}>
                  <td>{formatearFecha(g.fecha)}</td>
                  <td>{g.categoria}</td>
                  <td style={{ fontWeight: 600 }}>${Number(g.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                  <td>{g.corral || '—'}</td>
                  <td>{g.descripcion || '—'}</td>
                  <td>
                    {esAdmin && (
                      <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.8rem' }} onClick={() => setEditando(g)}>
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {mostrarModal && (
        <RegistrarGastoModal onCerrar={() => setMostrarModal(false)} onCreado={async () => { setMostrarModal(false); await cargar(); mostrarExito({ titulo: 'Gasto registrado' }); }} />
      )}
      {editando && (
        <RegistrarGastoModal registro={editando} onCerrar={() => setEditando(null)} onCreado={async () => { setEditando(null); await cargar(); mostrarExito({ titulo: 'Gasto actualizado' }); }} />
      )}
    </div>
  );
}
