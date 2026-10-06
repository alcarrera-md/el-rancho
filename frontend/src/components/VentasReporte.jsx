import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { exportarVentasPDF, exportarVentasExcel } from '../exportUtils.js';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import { EncabezadoDetalle, PresentacionPantalla, SelectorDetalle } from './PresentacionGuiada.jsx';
import { IconoAnimal, IconoCalendario, IconoDinero, IconoPersonas, IconoReportes } from './Iconos.jsx';

function formatearFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function VentasReporte() {
  const [reporte, setReporte] = useState(null);
  const [lotes, setLotes] = useState(null);
  const [compradores, setCompradores] = useState([]);
  const [error, setError] = useState(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [compradorId, setCompradorId] = useState('');
  const [exportando, setExportando] = useState(null);
  const [vista, setVista] = useState('individuales');

  const resumenComercial = useMemo(() => {
    const ventas = reporte?.ventas || [];
    const total = Number(reporte?.total_ingresos) || 0;
    const precios = ventas.map((venta) => Number(venta.precio) || 0);
    return {
      promedio: ventas.length ? total / ventas.length : 0,
      compradores: new Set(ventas.map((venta) => venta.comprador).filter(Boolean)).size,
      maximo: Math.max(0, ...precios),
      pulso: ventas.slice(-8),
    };
  }, [reporte]);

  function cargar() {
    setError(null);
    const params = {};
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    if (compradorId) params.tercero_id = compradorId;
    api.reporteVentas(params).then(setReporte).catch((err) => setError(err.message));
  }

  useEffect(cargar, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.listarVentasLote().then(setLotes).catch(() => {}); }, []);
  useEffect(() => { api.listarTerceros('comprador').then(setCompradores).catch(() => {}); }, []);

  function textoFiltro() {
    const partes = [];
    if (compradorId) {
      const c = compradores.find((x) => String(x.id) === String(compradorId));
      if (c) partes.push(`Comprador: ${c.nombre}`);
    }
    if (desde || hasta) partes.push(`Periodo: ${desde || 'inicio'} al ${hasta || 'hoy'}`);
    return partes.join(' — ');
  }

  async function exportar(formato) {
    setExportando(formato);
    setError(null);
    try {
      if (formato === 'pdf') await exportarVentasPDF(reporte.ventas, reporte.total_ingresos, textoFiltro());
      else await exportarVentasExcel(reporte.ventas);
    } catch (err) {
      setError(`No se pudo preparar la exportación: ${err.message}`);
    } finally {
      setExportando(null);
    }
  }

  return (
    <div className="sales-page">
      <PresentacionPantalla
        etiqueta="Actividad comercial"
        titulo="Ventas del rancho"
        descripcion="Comprueba el resultado del periodo y consulta cada trato por animal o por lote. Los filtros y exportaciones quedan disponibles cuando los necesites."
        className="sales-module-header"
        icono={IconoDinero}
        acento="venta"
      />

      {error && <EstadoError mensaje={error} onReintentar={cargar} />}

      {reporte && (
        <section className="sales-overview" aria-label="Resumen comercial del periodo">
          <div className="sales-revenue-panel">
            <span className="sales-revenue-icon"><IconoDinero /></span>
            <div className="sales-revenue-copy"><small>Ingresos del periodo</small><strong>${Number(reporte.total_ingresos).toLocaleString('es-MX')}</strong><span>{textoFiltro() || 'Todos los compradores y fechas disponibles'}</span></div>
            <div className="sales-pulse" role="img" aria-label={`Comparación visual de las últimas ${resumenComercial.pulso.length} ventas`}>
              {resumenComercial.pulso.length === 0 ? <span className="sales-pulse-empty">Sin operaciones</span> : resumenComercial.pulso.map((venta, indice) => <i key={`${venta.fecha}-${venta.arete_id}-${indice}`} style={{ height: `${Math.max(16, ((Number(venta.precio) || 0) / (resumenComercial.maximo || 1)) * 100)}%` }} title={`${venta.arete_id}: $${Number(venta.precio).toLocaleString('es-MX')}`} />)}
            </div>
          </div>
          <div className="sales-summary-strip">
            <div><span><IconoAnimal /></span><strong>{reporte.ventas.length}</strong><small>Animales vendidos</small></div>
            <div><span><IconoDinero /></span><strong>${Math.round(resumenComercial.promedio).toLocaleString('es-MX')}</strong><small>Venta promedio</small></div>
            <div><span><IconoPersonas /></span><strong>{resumenComercial.compradores}</strong><small>Compradores en el periodo</small></div>
            <div><span><IconoReportes /></span><strong>{lotes?.length ?? '—'}</strong><small>Lotes registrados</small></div>
          </div>
        </section>
      )}

      <details className="module-toolbar-details">
        <summary>Filtrar periodo, comprador o exportar{textoFiltro() ? ' · filtros activos' : ''}</summary>
      <div className="toolbar">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="ventas-desde">Desde</label>
          <input id="ventas-desde" className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="ventas-hasta">Hasta</label>
          <input id="ventas-hasta" className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="ventas-comprador">Comprador</label>
          <select id="ventas-comprador" value={compradorId} onChange={(e) => setCompradorId(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Todos</option>
            {compradores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" style={{ alignSelf: 'flex-end' }} onClick={cargar}>Filtrar</button>
        {reporte && reporte.ventas.length > 0 && <>
          <button className="btn btn-ghost" disabled={Boolean(exportando)} onClick={() => exportar('pdf')}>{exportando === 'pdf' ? 'Preparando PDF…' : 'Exportar PDF'}</button>
          <button className="btn btn-ghost" disabled={Boolean(exportando)} onClick={() => exportar('excel')}>{exportando === 'excel' ? 'Preparando Excel…' : 'Exportar Excel'}</button>
        </>}
      </div>
      </details>

      <EncabezadoDetalle titulo="Detalle de ventas" descripcion="Alterna entre el historial por animal y los tratos que reunieron varios animales." paso="Detalle" />
      <SelectorDetalle valor={vista} onSeleccionar={setVista} opciones={[
        { id: 'individuales', etiqueta: 'Por animal', contador: reporte?.ventas.length },
        { id: 'lotes', etiqueta: 'Por lote', contador: lotes?.length },
      ]} />

      {vista === 'lotes' && (
        <>
          <div className="sales-record-panel">
            {!lotes ? <EstadoCarga mensaje="Cargando ventas por lote…" /> : lotes.length === 0 ? <EstadoVacio titulo="Todavía no hay ventas por lote" descripcion="Los tratos que incluyan varios animales aparecerán aquí." /> : <div className="sales-lot-grid">
              {lotes.map((l) => (
                <article className="sales-lot-card" key={l.id}>
                  <span className="sales-record-icon"><IconoReportes /></span>
                  <div className="sales-lot-main"><small>Venta por lote</small><strong>{l.comprador || 'Comprador sin nombre'}</strong><span><IconoCalendario /> {formatearFecha(l.fecha)}</span></div>
                  <div className="sales-lot-count"><strong>{l.total_animales}</strong><span>animales</span></div>
                  <div className="sales-record-price"><small>Total</small><strong>${Number(l.precio_total).toLocaleString('es-MX')}</strong><span>Factura {l.factura_folio || 'sin folio'}</span></div>
                </article>
              ))}
            </div>}
          </div>
        </>
      )}

      {vista === 'individuales' && <>
      <div className="sales-record-panel">
        {!reporte ? (
          <EstadoCarga mensaje="Cargando ventas…" />
        ) : reporte.ventas.length === 0 ? (
          <EstadoVacio titulo="No hay ventas en este periodo" descripcion="Cambia los filtros o registra una venta desde el flujo autorizado." />
        ) : (
          <div className="sales-record-list">
            {reporte.ventas.map((v, i) => (
              <article className="sales-record-card" key={`${v.fecha}-${v.arete_id}-${i}`}>
                <span className="sales-record-icon"><IconoAnimal /></span>
                <div className="sales-record-animal"><small>Animal vendido</small><strong>{v.arete_id}</strong><span className="tag-badge">Arete {v.arete_id}</span></div>
                <div className="sales-record-buyer"><small>Comprador</small><strong>{v.comprador || 'Sin comprador registrado'}</strong></div>
                <time><IconoCalendario />{formatearFecha(v.fecha)}</time>
                <div className="sales-record-price"><small>Precio</small><strong>${Number(v.precio).toLocaleString('es-MX')}</strong></div>
              </article>
            ))}
          </div>
        )}
      </div>
      </>}
    </div>
  );
}
