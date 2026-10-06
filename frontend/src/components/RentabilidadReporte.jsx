import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { calcularPanoramaEconomico, filtrarRentabilidadAnimales, margenAnimal } from '../rentabilidadUx.js';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import { PresentacionPantalla } from './PresentacionGuiada.jsx';
import { IconoBalanza, IconoDinero, IconoReportes } from './Iconos.jsx';
import { actualizarContexto } from '../navigationContext.js';

function formatoMoneda(n) {
  return `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function TarjetaIndicador({ etiqueta, valor, ayuda, tono = '', icono: Icono, lectura }) {
  return <article className={`economic-kpi card ${tono}`.trim()}><span className="economic-kpi-icon" aria-hidden="true"><Icono width={22} height={22} /></span><div><span>{etiqueta}</span><strong>{valor}</strong>{lectura && <small>{lectura}</small>}</div><abbr title={ayuda} aria-label={`${etiqueta}: ${ayuda}`}>?</abbr></article>;
}

function BarraConcepto({ concepto, total, onAbrir }) {
  const porcentaje = total > 0 ? Math.round((concepto.valor / total) * 100) : 0;
  return <div className="economic-breakdown-row"><div><strong>{concepto.etiqueta}</strong><span>{formatoMoneda(concepto.valor)} · {porcentaje}%</span></div><div className="economic-breakdown-track" aria-hidden="true"><span style={{ width: `${porcentaje}%` }} /></div>{concepto.destino && <button type="button" className="btn btn-ghost" onClick={() => onAbrir(concepto.destino)}>Ver origen</button>}</div>;
}

const ESTADO_LABEL = { vivo: 'Activo', vendido: 'Vendido', sacrificado: 'Sacrificado', muerto: 'Muerto' };

export default function RentabilidadReporte() {
  const navigate = useNavigate();
  const [parametros, setParametros] = useSearchParams();
  const [finanzas, setFinanzas] = useState(null);
  const [rentabilidad, setRentabilidad] = useState(null);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(parametros.get('desde') || '') ? parametros.get('desde') : '';
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(parametros.get('hasta') || '') ? parametros.get('hasta') : '';
  const [estado, setEstado] = useState('');
  const [consulta, setConsulta] = useState('');
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);

  async function cargar() {
    setCargando(true); setError(null);
    const params = {};
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    try {
      const [resumenFinanciero, detalleAnimal] = await Promise.all([api.reporteFinanciero(params), api.reporteRentabilidad()]);
      setFinanzas(resumenFinanciero); setRentabilidad(detalleAnimal);
    } catch (err) { setError(err.message); } finally { setCargando(false); }
  }

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [desde, hasta]);

  const panorama = useMemo(() => calcularPanoramaEconomico(finanzas), [finanzas]);
  const animales = useMemo(() => filtrarRentabilidadAnimales(rentabilidad?.animales || [], { estado, consulta }), [rentabilidad, estado, consulta]);
  const resultadoPositivo = Number(panorama?.resultado || 0) >= 0;
  const periodoTexto = desde || hasta ? `${desde || 'inicio'} a ${hasta || 'hoy'}` : 'Todo el historial registrado';

  function cambiarPeriodo(cambios) {
    setParametros(actualizarContexto(parametros, cambios), { replace: true });
  }

  return <div className="economic-page">
    <PresentacionPantalla etiqueta="Resultado del rancho" titulo="Cómo está rindiendo el rancho" descripcion="Compara lo que entró con lo que salió, identifica qué pesa más y después profundiza por animal." icono={IconoBalanza} />
    {error && <EstadoError mensaje={error} onReintentar={cargar} />}
    <section className="economic-filter card" aria-label="Periodo del panorama económico"><div><strong>Periodo del panorama</strong><span>{periodoTexto}</span></div><label>Desde<input className="input" type="date" value={desde} onChange={(e) => cambiarPeriodo({ desde: e.target.value })} /></label><label>Hasta<input className="input" type="date" value={hasta} onChange={(e) => cambiarPeriodo({ hasta: e.target.value })} /></label>{(desde || hasta) && <button type="button" className="btn btn-ghost" onClick={() => cambiarPeriodo({ desde: null, hasta: null })}>Limpiar</button>}</section>
    {cargando && !panorama ? <div className="card"><EstadoCarga mensaje="Calculando el resultado económico…" /></div> : panorama && <>
      <section aria-labelledby="panorama-economico"><div className="guided-section-heading"><div><span className="guided-eyebrow">Panorama económico</span><h2 id="panorama-economico">Resultado del periodo</h2><p>Cálculo basado en ventas, valor estimado de la leche, compras y gastos registrados.</p></div></div><div className="economic-kpi-grid">
        <TarjetaIndicador etiqueta="Ingresos" valor={formatoMoneda(panorama.ingresos)} ayuda="Dinero registrado por ventas y valor estimado de la leche en el periodo." icono={IconoDinero} />
        <TarjetaIndicador etiqueta="Costos y gastos" valor={formatoMoneda(panorama.costos)} ayuda="Compras de insumos, compras de animales y gastos generales del periodo." icono={IconoReportes} />
        <TarjetaIndicador etiqueta="Resultado" valor={formatoMoneda(panorama.resultado)} ayuda="Ingresos menos costos y gastos registrados." tono={resultadoPositivo ? 'positivo' : 'negativo'} icono={IconoBalanza} lectura={resultadoPositivo ? 'El periodo deja saldo favorable.' : 'El periodo deja una pérdida registrada.'} />
        <TarjetaIndicador etiqueta="Margen" valor={panorama.margen === null ? 'Sin base' : `${panorama.margen}%`} ayuda="Porcentaje del ingreso que permanece después de restar costos y gastos." tono={panorama.margen !== null && panorama.margen < 0 ? 'negativo' : ''} icono={IconoDinero} lectura={panorama.margen === null ? 'Registra ingresos para calcularlo.' : `Por cada $100 ingresados, ${panorama.margen >= 0 ? 'permanecen' : 'faltan'} aproximadamente $${Math.abs(panorama.margen).toFixed(1)}.`} />
      </div></section>
      <section className="economic-origin-section" aria-labelledby="origen-resultado"><div className="guided-section-heading"><div><span className="guided-eyebrow">¿De dónde viene?</span><h2 id="origen-resultado">Qué está formando el resultado</h2><p>{panorama.mayorCosto?.valor > 0 ? `${panorama.mayorCosto.etiqueta} es el costo registrado de mayor peso.` : 'Todavía no hay costos registrados en el periodo.'}</p></div></div><div className="economic-breakdown-grid"><article className="card"><h3>Ingresos</h3><p>Ventas registradas y valor estimado de la leche.</p>{panorama.conceptosIngreso.map((concepto) => <BarraConcepto key={concepto.id} concepto={concepto} total={panorama.ingresos} onAbrir={navigate} />)}</article><article className="card"><h3>Costos y gastos</h3><p>Lo que redujo el resultado.</p>{panorama.conceptosCosto.map((concepto) => <BarraConcepto key={concepto.id} concepto={concepto} total={panorama.costos} onAbrir={navigate} />)}</article></div></section>
    </>}
    <section className="economic-animal-section" aria-labelledby="analizar-rentabilidad"><div className="guided-section-heading"><div><span className="guided-eyebrow">Profundizar</span><h2 id="analizar-rentabilidad">Analizar rentabilidad por animal</h2><p>Estimación acumulada: compra, alimentación y salud contra venta y leche. No incluye gastos generales.</p></div></div>
      {rentabilidad?.precio_leche_litro === 0 && <div className="context-note" role="note">La leche no suma ingreso porque su precio por litro está en $0. Puedes configurarlo en Configuración.</div>}
      <div className="economic-animal-filters card"><label>Buscar animal<input className="input" type="search" value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Arete o alias" /></label><label>Estado productivo<select value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option><option value="vivo">Activos</option><option value="vendido">Vendidos</option><option value="sacrificado">Sacrificados</option><option value="muerto">Muertos</option></select></label><span>{animales.length} animal(es)</span></div>
      {!rentabilidad ? <div className="card"><EstadoCarga mensaje="Calculando rentabilidad por animal…" /></div> : animales.length === 0 ? <div className="card"><EstadoVacio titulo="No hay animales con esos filtros" descripcion="Prueba otro arete, alias o estado productivo." /></div> : <div className="economic-animal-grid">{animales.map((animal) => { const margen = margenAnimal(animal); const favorable = Number(animal.neto) >= 0; return <article key={animal.id} className={`card economic-animal-card ${favorable ? 'positivo' : 'negativo'}`}><div className="economic-animal-title"><div><span className="tag-badge">{animal.arete_id}</span><h3>{animal.nombre_alias || 'Sin alias'}</h3></div><span className="operational-badge">{ESTADO_LABEL[animal.estado] || animal.estado}</span></div><dl><div><dt>Ingreso acumulado</dt><dd>{formatoMoneda(animal.ingreso_total)}</dd></div><div><dt>Costo estimado</dt><dd>{formatoMoneda(animal.costo_total)}</dd></div><div><dt>Resultado</dt><dd>{formatoMoneda(animal.neto)}</dd></div><div><dt>Margen</dt><dd>{margen === null ? 'Sin ingreso' : `${margen}%`}</dd></div></dl><p><strong>{favorable ? 'Saldo favorable' : 'Saldo por recuperar'}.</strong> Alimentación: {formatoMoneda(animal.costo_alimentacion)} · Salud: {formatoMoneda(animal.costo_salud)}.</p><button type="button" className="btn btn-ghost" onClick={() => navigate(`/animales/${animal.id}/seguimiento`)}>Abrir seguimiento</button></article>; })}</div>}
    </section>
  </div>;
}
