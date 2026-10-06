import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import { estadoStock, estaCaducado, filtrarOrdenarInsumos, nivelStock, resumirInsumos } from '../insumosUx.js';
import { actualizarContexto, crearRutaContextual, leerIdContexto } from '../navigationContext.js';
import { mostrarExito } from '../feedbackOperacion.js';
import NuevoInsumoModal from './NuevoInsumoModal.jsx';
import EditarInsumoModal from './EditarInsumoModal.jsx';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import ContextoNavegacion from './ContextoNavegacion.jsx';
import { PresentacionPantalla } from './PresentacionGuiada.jsx';
import { IconoCheck, IconoDinero, IconoHoja, IconoPaquete, IconoSalud } from './Iconos.jsx';

const TIPO_LABEL = { alimento: 'Alimento', vacuna: 'Vacuna', medicamento: 'Medicamento', otro: 'Otro' };
const ESTADO_LABEL = { bien: 'Nivel suficiente', bajo: 'Stock bajo', agotado: 'Agotado' };

function formatearFecha(fecha) {
  if (!fecha) return 'Sin vencimiento registrado';
  return new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function InsumosList() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [parametros, setParametros] = useSearchParams();
  const puedeGestionar = tienePermiso(usuario?.rol, 'insumos', 'crear');
  const puedeComprar = tienePermiso(usuario?.rol, 'compras_insumo', 'crear');
  const [insumos, setInsumos] = useState(null);
  const [error, setError] = useState(null);
  const [mostrarModal, setMostrarModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const insumoContextoId = leerIdContexto(parametros, 'insumo');
  const consulta = parametros.get('q') || '';
  const tipo = parametros.get('tipo') || '';
  const soloAtencion = parametros.get('vista') === 'atencion';

  function cargar() {
    setError(null);
    return api.listarInsumos().then(setInsumos).catch((err) => { setError(err.message); throw err; });
  }
  useEffect(() => { cargar().catch(() => {}); }, []);

  function cambiarParametro(clave, valor) {
    const siguientes = new URLSearchParams(parametros);
    if (valor) siguientes.set(clave, valor); else siguientes.delete(clave);
    setParametros(siguientes, { replace: true });
  }

  const resumen = useMemo(() => resumirInsumos(insumos || []), [insumos]);
  const insumoContexto = useMemo(() => (insumos || []).find((item) => String(item.id) === insumoContextoId) || null, [insumos, insumoContextoId]);
  const visiblesFiltrados = useMemo(() => filtrarOrdenarInsumos(insumos || [], { tipo, consulta, soloAtencion }), [insumos, tipo, consulta, soloAtencion]);
  const visibles = insumoContexto ? [insumoContexto] : visiblesFiltrados;
  const atencion = useMemo(() => filtrarOrdenarInsumos(insumos || [], { soloAtencion: true }), [insumos]);

  function quitarContexto() {
    setParametros(actualizarContexto(parametros, { insumo: null }), { replace: true });
  }

  function abrirCompra(insumo) {
    navigate(crearRutaContextual('/compras', { vista: 'insumos', insumo: insumo.id, accion: 'comprar' }));
  }

  return <div className="inventory-page">
    <PresentacionPantalla etiqueta="Existencias del rancho" titulo="Existencias y necesidades" descripcion="Aquí ves lo que tienes, lo que está por acabarse y qué conviene reabastecer primero." accion={puedeGestionar ? <button className="btn btn-primary" onClick={() => setMostrarModal(true)}>Registrar insumo</button> : null} icono={IconoPaquete} />
    {error && <EstadoError mensaje={error} onReintentar={cargar} />}
    {insumos && insumoContextoId && <ContextoNavegacion etiqueta={insumoContexto?.nombre || `Insumo ${insumoContextoId}`} descripcion={insumoContexto ? 'El inventario se abrió desde otro módulo.' : 'El insumo solicitado ya no está disponible; se muestra el inventario completo.'} invalido={!insumoContexto} onLimpiar={quitarContexto} />}
    {!insumos ? <div className="card"><EstadoCarga mensaje="Revisando existencias…" /></div> : insumos.length === 0 ? <div className="card"><EstadoVacio titulo="Todavía no hay insumos" descripcion="Registra alimento, vacunas o medicamentos para comenzar a controlar existencias." accion={puedeGestionar ? <button className="btn btn-primary" onClick={() => setMostrarModal(true)}>Registrar primer insumo</button> : null} /></div> : <>
      <section aria-labelledby="inventario-panorama"><div className="guided-section-heading"><div><span className="guided-eyebrow">Panorama</span><h2 id="inventario-panorama">Estado del inventario</h2><p>{atencion.length ? `${atencion.length} insumo(s) requieren atención.` : 'Todas las existencias están por encima del mínimo registrado.'}</p></div></div><div className="inventory-summary-grid">
        <article className="card"><IconoCheck aria-hidden="true" /><strong>{resumen.bien}</strong><span>En buen nivel</span></article>
        <article className={`card ${resumen.bajo ? 'atencion' : ''}`}><IconoHoja aria-hidden="true" /><strong>{resumen.bajo}</strong><span>Stock bajo</span></article>
        <article className={`card ${resumen.agotado ? 'critico' : ''}`}><IconoSalud aria-hidden="true" /><strong>{resumen.agotado}</strong><span>Agotados</span></article>
        <article className="card"><IconoPaquete aria-hidden="true" /><strong>{resumen.total}</strong><span>Total · {resumen.categorias} categorías</span></article>
      </div></section>

      {atencion.length > 0 && <section className="inventory-attention" aria-labelledby="insumos-atencion"><div className="guided-section-heading"><div><span className="guided-eyebrow">Prioridad</span><h2 id="insumos-atencion">Necesitan atención</h2><p>Agotados, debajo del mínimo o con caducidad vencida aparecen primero.</p></div></div><div className="inventory-attention-strip">{atencion.slice(0, 4).map((insumo) => <article key={insumo.id} className="card"><span className={`stock-status estado-${estadoStock(insumo)}`}>{ESTADO_LABEL[estadoStock(insumo)]}</span><strong>{insumo.nombre}</strong><span>{insumo.stock_actual} {insumo.unidad_medida} disponibles</span>{puedeComprar && <button type="button" className="btn btn-primary" onClick={() => abrirCompra(insumo)}>Registrar compra</button>}</article>)}</div></section>}

      <section aria-labelledby="inventario-completo"><div className="guided-section-heading"><div><span className="guided-eyebrow">Inventario completo</span><h2 id="inventario-completo">Consulta y actúa</h2><p>Los filtros permanecen en la dirección de la página para que puedas volver al mismo análisis.</p></div></div>
        <div className="inventory-toolbar card"><label>Buscar<input className="input" type="search" value={consulta} onChange={(e) => cambiarParametro('q', e.target.value)} placeholder="Nombre del insumo" /></label><label>Tipo<select value={tipo} onChange={(e) => cambiarParametro('tipo', e.target.value)}><option value="">Todos</option>{Object.entries(TIPO_LABEL).map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}</select></label><div className="inventory-view-toggle" role="group" aria-label="Alcance del inventario"><button type="button" className={!soloAtencion ? 'activo' : ''} aria-pressed={!soloAtencion} onClick={() => cambiarParametro('vista', '')}>Todos</button><button type="button" className={soloAtencion ? 'activo' : ''} aria-pressed={soloAtencion} onClick={() => cambiarParametro('vista', 'atencion')}>Con atención</button></div><span>{visibles.length} resultado(s)</span></div>
        {visibles.length === 0 ? <div className="card"><EstadoVacio titulo="No hay insumos con esos filtros" descripcion="Limpia la búsqueda o cambia el tipo de insumo." /></div> : <div className="inventory-card-grid">{visibles.map((insumo) => { const estado = estadoStock(insumo); const nivel = nivelStock(insumo); const caducado = estaCaducado(insumo); const maximo = Math.max(Number(insumo.stock_actual), Number(insumo.stock_minimo) * 2, 1); return <article key={insumo.id} className={`card inventory-item estado-${estado}`}><div className="inventory-item-head"><span className="inventory-item-icon" aria-hidden="true"><IconoPaquete /></span><div><span>{TIPO_LABEL[insumo.tipo] || insumo.tipo}</span><h3>{insumo.nombre}</h3></div><span className={`stock-status estado-${estado}`}>{ESTADO_LABEL[estado]}</span></div><div className="inventory-stock-value"><strong>{insumo.stock_actual}</strong><span>{insumo.unidad_medida} disponibles</span></div><div className="inventory-stock-track" role="progressbar" aria-label={`${insumo.nombre}: ${insumo.stock_actual} ${insumo.unidad_medida}; mínimo ${insumo.stock_minimo}`} aria-valuemin="0" aria-valuemax={maximo} aria-valuenow={Number(insumo.stock_actual)}><span style={{ width: `${nivel.porcentaje}%` }} /><i style={{ left: `${nivel.minimo}%` }} title="Stock mínimo" /></div><div className="inventory-stock-meta"><span>Mínimo: {insumo.stock_minimo} {insumo.unidad_medida}</span><span className={caducado ? 'caducado' : ''}>{caducado ? 'Caducado: ' : 'Caducidad: '}{formatearFecha(insumo.fecha_caducidad)}</span></div><div className="inventory-item-actions">{puedeComprar && <button type="button" className="btn btn-primary" onClick={() => abrirCompra(insumo)}><IconoDinero aria-hidden="true" /> Registrar compra</button>}{puedeGestionar && <button type="button" className="btn btn-ghost" onClick={() => setEditando(insumo)}>Editar</button>}<button type="button" className="btn btn-ghost" onClick={() => navigate(crearRutaContextual('/alimentacion', { insumo: insumo.id }))}>Ver consumo</button><button type="button" className="btn btn-ghost" onClick={() => navigate(crearRutaContextual('/compras', { vista: 'insumos', insumo: insumo.id }))}>Ver compras</button></div></article>; })}</div>}
      </section>
    </>}
    {mostrarModal && <NuevoInsumoModal onCerrar={() => setMostrarModal(false)} onCreado={async () => { setMostrarModal(false); await cargar(); mostrarExito({ titulo: 'Insumo registrado correctamente' }); }} />}
    {editando && <EditarInsumoModal insumo={editando} onCerrar={() => setEditando(null)} onGuardado={async () => { setEditando(null); await cargar(); mostrarExito({ titulo: 'Insumo actualizado' }); }} />}
  </div>;
}
