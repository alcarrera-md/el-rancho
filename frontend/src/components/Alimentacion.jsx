import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import { EncabezadoDetalle, PresentacionPantalla } from './PresentacionGuiada.jsx';
import ContextoNavegacion from './ContextoNavegacion.jsx';
import { actualizarContexto, leerIdContexto } from '../navigationContext.js';

function formatearFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

function MiniStat({ valor, etiqueta, tono }) {
  return (
    <div className="mini-stat">
      <div className="valor" style={tono ? { color: `var(--${tono})` } : undefined}>{valor ?? '—'}</div>
      <div className="etiqueta">{etiqueta}</div>
    </div>
  );
}

export default function Alimentacion({ onAbrirSeguimiento }) {
  const [parametros, setParametros] = useSearchParams();
  const insumoContextoId = leerIdContexto(parametros, 'insumo');
  const [registros, setRegistros] = useState(null);
  const [stock, setStock] = useState(null);
  const [corrales, setCorrales] = useState(null);
  const [insumos, setInsumos] = useState(insumoContextoId ? null : []);
  const [corralFiltro, setCorralFiltro] = useState('');
  const [error, setError] = useState(null);

  function cargar(params = {}) {
    setError(null);
    return api.listarAlimentacion(params).then(setRegistros).catch((err) => setError(err.message));
  }

  useEffect(() => {
    api.stockBajo().then(setStock).catch((err) => setError(err.message));
    api.listarCorrales().then(setCorrales).catch((err) => setError(err.message));
    if (insumoContextoId) api.listarInsumos().then(setInsumos).catch(() => setInsumos([]));
  }, [insumoContextoId]);

  const insumoContexto = useMemo(() => (insumos || []).find((insumo) => String(insumo.id) === insumoContextoId) || null, [insumos, insumoContextoId]);
  const insumoAplicadoId = insumos === null ? insumoContextoId : insumoContexto?.id;

  useEffect(() => {
    cargar({ ...(corralFiltro ? { corral_id: corralFiltro } : {}), ...(insumoAplicadoId ? { insumo_id: insumoAplicadoId } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corralFiltro, insumoAplicadoId]);

  function quitarContexto() {
    setParametros(actualizarContexto(parametros, { insumo: null }), { replace: true });
  }

  const stats30dias = useMemo(() => {
    if (!registros) return null;
    const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
    const recientes = registros.filter((r) => new Date(r.fecha) >= hace30);
    return { registros: recientes.length, animales: new Set(recientes.map((r) => r.animal_id).filter(Boolean)).size };
  }, [registros]);

  return (
    <div>
      <PresentacionPantalla
        etiqueta="Operación diaria"
        titulo="Alimentación y consumo"
        descripcion="Comprueba primero si falta alimento y después consulta qué se suministró a cada animal o corral."
      />
      {insumos && insumoContextoId && <ContextoNavegacion etiqueta={insumoContexto?.nombre || `Insumo ${insumoContextoId}`} descripcion={insumoContexto ? 'El historial muestra únicamente consumos registrados con este insumo.' : 'El insumo solicitado ya no está disponible; se muestra todo el consumo.'} invalido={!insumoContexto} onLimpiar={quitarContexto} />}

      {error && <EstadoError mensaje={error} onReintentar={() => {
        cargar({ ...(corralFiltro ? { corral_id: corralFiltro } : {}), ...(insumoAplicadoId ? { insumo_id: insumoAplicadoId } : {}) });
        api.stockBajo().then(setStock).catch((err) => setError(err.message));
        api.listarCorrales().then(setCorrales).catch((err) => setError(err.message));
      }} />}

      <div className="dashboard-grid">
        <div className="card dashboard-card">
          <div className="dashboard-card-titulo">Panorama de alimentación</div>
          <div className="mini-stats">
            <MiniStat valor={stats30dias?.registros ?? '—'} etiqueta="Registros (30 días)" />
            <MiniStat valor={stats30dias?.animales ?? '—'} etiqueta="Animales atendidos" />
            <MiniStat valor={stock?.length ?? '—'} etiqueta="Insumos con stock bajo" tono={stock?.length ? 'rust' : undefined} />
          </div>
        </div>
      </div>

      <div className="guided-section-heading"><span className="guided-step">Atención</span><div><h2>Existencias que requieren revisión</h2><p>Los insumos por debajo de su mínimo aparecen antes del historial de suministros.</p></div></div>
      <div className="card" style={{ marginBottom: 24 }}>
        {!stock ? (
          <EstadoCarga mensaje="Revisando existencias…" />
        ) : stock.length === 0 ? (
          <EstadoVacio titulo="Inventario en niveles saludables" descripcion="Ningún insumo está por debajo de su mínimo configurado." compacto />
        ) : (
          <table className="animal-table responsive-cards">
            <thead><tr><th>Insumo</th><th>Stock actual</th><th>Mínimo</th></tr></thead>
            <tbody>
              {stock.map((i) => (
                <tr key={i.id}>
                  <td data-label="Insumo">{i.nombre}</td>
                  <td data-label="Stock actual" style={{ color: Number(i.stock_actual) === 0 ? 'var(--rust)' : 'inherit', fontWeight: Number(i.stock_actual) === 0 ? 600 : 400 }}>
                    {i.stock_actual} {i.unidad_medida}
                  </td>
                  <td data-label="Mínimo">{i.stock_minimo} {i.unidad_medida}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <EncabezadoDetalle titulo="Suministros registrados" descripcion="Consulta la actividad reciente y filtra solo cuando necesites revisar un corral específico." paso="Detalle" />
      <details className="module-toolbar-details">
        <summary>Filtrar por corral{corralFiltro ? ' · 1 filtro activo' : ''}</summary>
        <div className="toolbar">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="alimentacion-corral">Corral</label>
            <select id="alimentacion-corral" value={corralFiltro} onChange={(e) => setCorralFiltro(e.target.value)}>
              <option value="">Todos los corrales</option>
              {(corrales || []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        </div>
      </details>

      <div className="card" style={{ padding: '10px 0' }}>
        {!registros ? (
          <EstadoCarga mensaje="Cargando registros de alimentación…" />
        ) : registros.length === 0 ? (
          <EstadoVacio titulo="Sin registros de alimentación" descripcion={corralFiltro ? 'No hay registros para el corral seleccionado.' : 'Los suministros registrados aparecerán aquí.'} />
        ) : (
          <table className="animal-table responsive-cards">
            <thead><tr><th>Animal / Lote</th><th>Corral</th><th>Insumo</th><th>Cantidad</th><th style={{ textAlign: 'right' }}>Fecha</th><th>Acción</th></tr></thead>
            <tbody>
              {registros.map((r) => (
                <tr key={r.id}>
                  <td data-label="Animal / Lote">{r.animal_id ? <span className="tag-badge">{r.arete_id}</span> : <span style={{ color: 'var(--ink-soft)' }}>Por lote</span>}</td>
                  <td data-label="Corral" style={{ color: 'var(--ink-soft)' }}>{r.corral_nombre || '—'}</td>
                  <td data-label="Insumo">{r.insumo}</td>
                  <td data-label="Cantidad">{r.cantidad} {r.unidad_medida}</td>
                  <td data-label="Fecha" style={{ textAlign: 'right', color: 'var(--ink-soft)' }}>{formatearFecha(r.fecha)}</td>
                  <td data-label="Acción">{r.animal_id ? <button className="btn btn-ghost btn-table-action" onClick={() => onAbrirSeguimiento(r.animal_id)}>Ver animal</button> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
