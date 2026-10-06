import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import RegistrarCompraInsumoModal from './RegistrarCompraInsumoModal.jsx';
import NuevoAnimalModal from './NuevoAnimalModal.jsx';
import EstadoSaludBadge from './EstadoSaludBadge.jsx';
import { exportarComprasAnimalPDF } from '../exportUtils.js';
import { EstadoCarga, EstadoError, EstadoVacio, FeedbackOperacion } from './EstadosUI.jsx';
import { EncabezadoDetalle, PresentacionPantalla, SelectorDetalle } from './PresentacionGuiada.jsx';
import ContextoNavegacion from './ContextoNavegacion.jsx';
import { actualizarContexto, leerIdContexto } from '../navigationContext.js';

function formatearFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ComprasList() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [parametros, setParametros] = useSearchParams();
  const puedeComprar = tienePermiso(usuario?.rol, 'compras_animal', 'crear');
  const insumoContextoId = leerIdContexto(parametros, 'insumo');

  const [comprasInsumo, setComprasInsumo] = useState(null);
  const [comprasAnimal, setComprasAnimal] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [insumos, setInsumos] = useState(null);
  const [proveedorId, setProveedorId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [error, setError] = useState(null);
  const [modalActivo, setModalActivo] = useState(null); // 'insumo' | 'animal' | null
  const [confirmacion, setConfirmacion] = useState('');
  const [vista, setVista] = useState(['insumos', 'animales'].includes(parametros.get('vista')) ? parametros.get('vista') : 'insumos');
  const [mostrarOpcionesCompra, setMostrarOpcionesCompra] = useState(false);
  const aperturaAutomatica = useRef(null);

  function cargarComprasAnimal() {
    setError(null);
    const params = {};
    if (proveedorId) params.tercero_id = proveedorId;
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    api.listarComprasAnimal(params).then(setComprasAnimal).catch((err) => setError(err.message));
  }

  function cargar() {
    setError(null);
    api.listarComprasInsumo().then(setComprasInsumo).catch((err) => setError(err.message));
    cargarComprasAnimal();
    api.listarTerceros('proveedor').then(setProveedores).catch(() => {});
    api.listarInsumos().then(setInsumos).catch(() => setInsumos([]));
  }

  async function exportarCompras() {
    setError(null);
    try {
      await exportarComprasAnimalPDF(comprasAnimal, textoFiltro());
    } catch (err) {
      setError(`No se pudo preparar el PDF: ${err.message}`);
    }
  }
  useEffect(cargar, []); // eslint-disable-line react-hooks/exhaustive-deps

  const insumoContexto = useMemo(() => (insumos || []).find((item) => String(item.id) === insumoContextoId) || null, [insumos, insumoContextoId]);
  const comprasInsumoVisibles = insumoContexto ? (comprasInsumo || []).filter((compra) => String(compra.insumo_id) === insumoContextoId) : comprasInsumo;

  useEffect(() => {
    const vistaUrl = parametros.get('vista');
    if (['insumos', 'animales'].includes(vistaUrl) && vistaUrl !== vista) setVista(vistaUrl);
    const clave = `${insumoContextoId || ''}:${parametros.get('accion') || ''}`;
    if (insumos && puedeComprar && insumoContexto && parametros.get('accion') === 'comprar' && aperturaAutomatica.current !== clave) {
      aperturaAutomatica.current = clave;
      setVista('insumos');
      setModalActivo('insumo');
    }
  }, [parametros, insumos, insumoContexto, insumoContextoId, puedeComprar, vista]);

  function actualizarUrl(cambios, opciones = { replace: true }) {
    setParametros(actualizarContexto(parametros, cambios), opciones);
  }

  function seleccionarVista(siguiente) {
    setVista(siguiente);
    actualizarUrl({ vista: siguiente });
  }

  function quitarContexto() {
    aperturaAutomatica.current = null;
    actualizarUrl({ insumo: null, accion: null });
  }

  function cerrarModal() {
    setModalActivo(null);
    actualizarUrl({ accion: null });
  }

  function cerrarYRecargar() {
    setModalActivo(null);
    actualizarUrl({ accion: null });
    setConfirmacion('Compra registrada correctamente.');
    cargar();
  }

  function textoFiltro() {
    const partes = [];
    if (proveedorId) {
      const p = proveedores.find((x) => String(x.id) === String(proveedorId));
      if (p) partes.push(`Proveedor: ${p.nombre}`);
    }
    if (desde || hasta) partes.push(`Periodo: ${desde || 'inicio'} al ${hasta || 'hoy'}`);
    return partes.join(' — ');
  }

  const enfermosDelProveedor = comprasAnimal ? comprasAnimal.filter((c) => c.animal_estado === 'vivo' && c.estado_salud !== 'sano').length : 0;
  const totalInsumos = (comprasInsumo || []).reduce((total, compra) => total + Number(compra.costo_total || 0), 0);
  const totalAnimales = (comprasAnimal || []).reduce((total, compra) => total + Number(compra.precio || 0), 0);

  return (
    <div>
      <PresentacionPantalla
        etiqueta="Entradas al rancho"
        titulo="Compras e ingresos de insumos"
        descripcion="Registra una entrada y consulta por separado las compras de alimento, materiales y animales."
        accion={puedeComprar ? <button className="btn btn-primary guided-primary-action" onClick={() => setMostrarOpcionesCompra((visible) => !visible)}>Registrar compra</button> : null}
      />

      {mostrarOpcionesCompra && puedeComprar && <div className="module-action-choice" aria-label="Tipo de compra">
        <button className="btn btn-ghost" onClick={() => { setModalActivo('insumo'); setMostrarOpcionesCompra(false); }}><strong>Comprar insumo</strong><span>Aumenta las existencias del inventario.</span></button>
        <button className="btn btn-ghost" onClick={() => { setModalActivo('animal'); setMostrarOpcionesCompra(false); }}><strong>Comprar animal</strong><span>Da de alta al animal y conserva el registro comercial.</span></button>
      </div>}

      {error && <EstadoError mensaje={error} onReintentar={cargar} />}
      <FeedbackOperacion mensaje={confirmacion} />
      {insumos && insumoContextoId && <ContextoNavegacion etiqueta={insumoContexto?.nombre || `Insumo ${insumoContextoId}`} descripcion={insumoContexto ? 'El historial y la compra conservan el insumo seleccionado.' : 'El insumo solicitado ya no está disponible; se muestran todas las compras.'} invalido={!insumoContexto} onLimpiar={quitarContexto} />}

      <div className="resumen-grid">
        <div className="card resumen-item"><div className="valor">{comprasInsumo?.length ?? '—'}</div><div className="etiqueta">Compras de insumos</div></div>
        <div className="card resumen-item"><div className="valor">{comprasAnimal?.length ?? '—'}</div><div className="etiqueta">Animales comprados</div></div>
        <div className="card resumen-item"><div className="valor">{comprasInsumo && comprasAnimal ? `$${(totalInsumos + totalAnimales).toLocaleString('es-MX')}` : '—'}</div><div className="etiqueta">Importe visible</div></div>
      </div>
      <div className="contextual-shortcuts" aria-label="Continuar análisis de compras"><button type="button" className="btn btn-ghost" onClick={() => navigate('/gastos')}>Ver gastos generales</button><button type="button" className="btn btn-ghost" onClick={() => navigate('/rentabilidad')}>Ver impacto en Rentabilidad</button></div>

      <EncabezadoDetalle titulo="Historial de compras" descripcion="Elige el tipo de entrada que deseas revisar para evitar dos historiales extensos al mismo tiempo." paso="Detalle" />
      <SelectorDetalle valor={vista} onSeleccionar={seleccionarVista} opciones={[
        { id: 'insumos', etiqueta: 'Insumos', contador: comprasInsumo?.length },
        { id: 'animales', etiqueta: 'Animales', contador: comprasAnimal?.length },
      ]} />

      {vista === 'insumos' && <div className="module-detail">
      <div className="card" style={{ marginBottom: 28 }}>
        {!comprasInsumo ? (
          <EstadoCarga mensaje="Cargando compras de insumos…" />
        ) : comprasInsumoVisibles.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay compras de insumos" descripcion="Las entradas de inventario registradas aparecerán aquí." accion={puedeComprar ? <button className="btn btn-primary" onClick={() => setModalActivo('insumo')}>Comprar insumo</button> : null} />
        ) : (
          <table className="animal-table responsive-cards">
            <thead><tr><th>Fecha</th><th>Insumo</th><th>Proveedor</th><th>Cantidad</th><th>Costo</th></tr></thead>
            <tbody>
              {comprasInsumoVisibles.map((c) => (
                <tr key={c.id}>
                  <td data-label="Fecha">{formatearFecha(c.fecha)}</td>
                  <td data-label="Insumo">{c.insumo}</td>
                  <td data-label="Proveedor">{c.proveedor}</td>
                  <td data-label="Cantidad">{c.cantidad} {c.unidad_medida}</td>
                  <td data-label="Costo">{c.costo_total ? `$${Number(c.costo_total).toLocaleString('es-MX')}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>}

      {vista === 'animales' && <div className="module-detail">
      <details className="module-toolbar-details">
        <summary>Filtrar por proveedor o periodo y exportar{textoFiltro() ? ' · filtros activos' : ''}</summary>
        <div className="toolbar">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="compras-proveedor">Proveedor</label>
            <select id="compras-proveedor" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="">Todos</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="compras-desde">Desde</label>
            <input id="compras-desde" className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="compras-hasta">Hasta</label>
            <input id="compras-hasta" className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={cargarComprasAnimal}>Filtrar</button>
          {comprasAnimal && comprasAnimal.length > 0 && (
            <button className="btn btn-ghost" onClick={exportarCompras}>Exportar PDF</button>
          )}
        </div>
      </details>

      {proveedorId && comprasAnimal && comprasAnimal.length > 0 && (
        <div className="error-banner" style={{
          background: enfermosDelProveedor > 0 ? 'var(--rust-soft)' : 'var(--wheat-soft)',
          color: enfermosDelProveedor > 0 ? 'var(--rust)' : '#6b4f10',
          borderColor: enfermosDelProveedor > 0 ? '#e3b7ab' : 'var(--wheat)',
        }}>
          {enfermosDelProveedor > 0
            ? `${enfermosDelProveedor} de ${comprasAnimal.length} animal(es) comprados a este proveedor están actualmente enfermos o en observación.`
            : `Ninguno de los ${comprasAnimal.length} animal(es) comprados a este proveedor tiene problemas de salud registrados por ahora.`}
        </div>
      )}

      <div className="card">
        {!comprasAnimal ? (
          <EstadoCarga mensaje="Cargando compras de animales…" />
        ) : comprasAnimal.length === 0 ? (
          <EstadoVacio titulo={`Todavía no hay compras de animales${proveedorId ? ' de este proveedor' : ''}`} descripcion="Cambia los filtros o registra una nueva compra." accion={puedeComprar && !proveedorId ? <button className="btn btn-primary" onClick={() => setModalActivo('animal')}>Comprar animal</button> : null} />
        ) : (
          <table className="animal-table responsive-cards">
            <thead><tr><th>Fecha</th><th>Arete</th><th>Proveedor</th><th>Precio</th><th>Salud actual</th><th>Identificación previa</th></tr></thead>
            <tbody>
              {comprasAnimal.map((c) => (
                <tr key={c.id}>
                  <td data-label="Fecha">{formatearFecha(c.fecha)}</td>
                  <td data-label="Arete"><span className="tag-badge">{c.arete_id}</span></td>
                  <td data-label="Proveedor">{c.proveedor}</td>
                  <td data-label="Precio">{c.precio ? `$${Number(c.precio).toLocaleString('es-MX')}` : '—'}</td>
                  <td data-label="Salud actual"><EstadoSaludBadge estado={c.animal_estado} estadoSalud={c.estado_salud} tamano="chico" /></td>
                  <td data-label="Identificación previa">{c.identificacion_previa || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>}

      {modalActivo === 'insumo' && (
        <RegistrarCompraInsumoModal insumoInicialId={insumoContextoId || ''} onCerrar={cerrarModal} onCreado={cerrarYRecargar} />
      )}
      {modalActivo === 'animal' && (
        <NuevoAnimalModal origenInicial="compra" origenFijo onCerrar={() => setModalActivo(null)} onCreado={cerrarYRecargar} />
      )}
    </div>
  );
}
