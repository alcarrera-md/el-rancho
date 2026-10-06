import { useEffect, useState } from 'react';
import { api } from '../api';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import { IconoAnimal, IconoCalendario, IconoCheck, IconoCorazon, IconoLista } from './Iconos.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';

const PRESENTACION = {
  prenadas: { Icono: IconoCorazon, ayuda: 'Ciclos abiertos con diagnóstico positivo vigente.' },
  vacias: { Icono: IconoAnimal, ayuda: 'Último diagnóstico definitivo negativo dentro del ciclo vigente.' },
  pendientes: { Icono: IconoLista, ayuda: 'Servicios que ya alcanzaron la fecha sugerida de diagnóstico.' },
  revision: { Icono: IconoCheck, ayuda: 'Resultados dudosos o revisiones que necesitan seguimiento.' },
  proximos_partos: { Icono: IconoCalendario, ayuda: 'Gestaciones confirmadas cuya fecha estimada cae en el periodo.' },
  partos: { Icono: IconoAnimal, ayuda: 'Partos reales; las crías se presentan por separado.' },
  tasa_prenez: { Icono: IconoCorazon, ayuda: 'Preñadas entre diagnósticos definitivos; dudosas y pendientes quedan fuera.' },
  servicios_por_concepcion: { Icono: IconoLista, ayuda: 'Solo gestaciones cuyo servicio de concepción puede identificarse.' },
  intervalo_partos: { Icono: IconoCalendario, ayuda: 'Días reales entre partos consecutivos de una misma vaca.' },
  perdidas: { Icono: IconoCheck, ayuda: 'Abortos y pérdidas registrados durante el periodo.' },
};

const METRICAS_VISIBLES = [
  'prenadas', 'vacias', 'pendientes', 'revision', 'proximos_partos', 'partos',
  'tasa_prenez', 'servicios_por_concepcion', 'intervalo_partos', 'perdidas',
];

function textoValor(metrica) {
  if (metrica.estado === 'datos_insuficientes' || metrica.valor == null) return 'Datos insuficientes';
  if (metrica.unidad === 'porcentaje') return `${metrica.valor} %`;
  if (metrica.unidad === 'días') return `${metrica.valor} días`;
  return String(metrica.valor);
}

function contextoMetrica(metrica) {
  if (metrica.clave === 'partos') return `${metrica.valor} parto(s) · ${metrica.crias || 0} cría(s)`;
  if (metrica.clave === 'tasa_prenez') return `${metrica.numerador} de ${metrica.denominador} diagnósticos definitivos`;
  if (metrica.clave === 'servicios_por_concepcion') return `${metrica.numerador} servicios en ${metrica.denominador} concepción(es)`;
  if (metrica.clave === 'intervalo_partos') return `${metrica.denominador} intervalo(s) válido(s)`;
  if (metrica.clave === 'perdidas') return `${metrica.abortos || 0} aborto(s) · ${metrica.perdidas || 0} pérdida(s)`;
  return `${metrica.numerador} registro(s)`;
}

function FiltrosPeriodo({ filtros, onChange }) {
  const personalizado = filtros.periodo === 'personalizado';
  return <div className="repro-analysis-filters">
    <label><span>Periodo</span><select value={filtros.periodo} onChange={(e) => onChange({ ...filtros, periodo: e.target.value, desde: '', hasta: '' })}><option value="mes_actual">Este mes</option><option value="anio_actual">Este año</option><option value="ultimos_30_dias">Últimos 30 días</option><option value="personalizado">Rango personalizado</option></select></label>
    {personalizado && <><label><span>Desde</span><input type="date" value={filtros.desde} onChange={(e) => onChange({ ...filtros, desde: e.target.value })} /></label><label><span>Hasta</span><input type="date" value={filtros.hasta} onChange={(e) => onChange({ ...filtros, hasta: e.target.value })} /></label></>}
  </div>;
}

function DetalleMetrica({ detalle, onCerrar, onAbrirSeguimiento }) {
  if (!detalle) return null;
  return <section className="repro-analysis-detail" aria-live="polite">
    <header><div><span>Conjunto exacto</span><h3>{detalle.metric.etiqueta}</h3><p>{detalle.total} registro(s) componen esta cifra.</p></div><button type="button" className="btn btn-ghost" onClick={onCerrar}>Cerrar</button></header>
    {detalle.items.length ? <div className="repro-analysis-list">{detalle.items.map((item, indice) => <article key={`${item.ciclo_id}-${item.fecha || indice}`}><div><strong>#{item.arete}</strong><span>{item.animal || 'Sin alias'} · {item.corral || 'Sin corral'}</span></div><div><small>{item.fecha || 'Sin fecha'}</small>{item.dias != null && <b>{item.dias} días</b>}{item.servicios != null && <b>{item.servicios} servicio(s)</b>}</div><button type="button" onClick={() => onAbrirSeguimiento(item.animal_id, { seccion: 'reproduccion' })}>Ver seguimiento</button></article>)}</div> : <EstadoVacio titulo="No hay registros para mostrar." compacto />}
  </section>;
}

function PerfilSemental({ perfil, onCerrar, onAbrirSeguimiento }) {
  if (!perfil) return null;
  return <section className="repro-sire-profile">
    <header><div><span>Perfil del semental · {perfil.estado || 'estado no registrado'}</span><h3>#{perfil.arete} · {perfil.nombre || 'Sin alias'}</h3></div><button type="button" className="btn btn-ghost" onClick={onCerrar}>Cerrar</button></header>
    <div className="repro-sire-facts"><div><strong>{perfil.servicios}</strong><span>Servicios</span></div><div><strong>{perfil.vacas_distintas}</strong><span>Vacas distintas</span></div><div><strong>{perfil.diagnosticos_positivos}</strong><span>Diagnósticos positivos</span></div><div><strong>{perfil.diagnosticos_negativos}</strong><span>Diagnósticos negativos</span></div><div><strong>{perfil.partos}</strong><span>Partos atribuibles</span></div><div><strong>{perfil.crias}</strong><span>Crías registradas</span></div></div>
    <p className="repro-completeness">Completitud diagnóstica: {perfil.completitud.porcentaje ?? 0} % · {perfil.servicios_sin_resultado} servicio(s) sin resultado.</p>
    {perfil.economia && <div className="repro-sire-economics"><strong>Costo atribuible: {Number(perfil.economia.costo_atribuible).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</strong><span>Costo por concepción: {perfil.economia.costo_por_concepcion == null ? 'Datos incompletos' : Number(perfil.economia.costo_por_concepcion).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span><span>Costo por parto: {perfil.economia.costo_por_parto == null ? 'Datos incompletos' : Number(perfil.economia.costo_por_parto).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span><small>Muestra atribuible: {perfil.economia.completitud.atribuibles} de {perfil.economia.completitud.muestra} ciclos. Se excluyen ciclos con más de un toro identificado.</small></div>}
    <button type="button" className="btn btn-ghost" onClick={() => onAbrirSeguimiento(perfil.id, { seccion: 'info' })}>Ver genealogía y seguimiento</button>
    <div className="repro-sire-history">{perfil.historial.map((evento, indice) => <article key={`${evento.ciclo_id}-${evento.fecha}-${indice}`}><time>{evento.fecha}</time><div><strong>Vaca #{evento.arete_vaca}</strong><span>{evento.evento === 'diagnostico' ? `Diagnóstico: ${evento.resultado}` : evento.evento === 'parto' ? 'Parto atribuible' : evento.tipo === 'natural' ? 'Servicio natural' : evento.tipo === 'inseminacion_artificial' ? 'Inseminación artificial' : 'Otro servicio'}</span></div></article>)}</div>
  </section>;
}

export default function ReproduccionAnalitica({ onAbrirSeguimiento }) {
  const { usuario } = useAuth();
  const [filtros, setFiltros] = useState({ periodo: 'anio_actual', desde: '', hasta: '' });
  const [resumen, setResumen] = useState(null);
  const [sementales, setSementales] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [error, setError] = useState('');

  async function cargar() {
    if (filtros.periodo === 'personalizado' && (!filtros.desde || !filtros.hasta)) {
      setResumen(null); setSementales(null); setDetalle(null); setPerfil(null); setError('');
      return;
    }
    setError(''); setResumen(null); setSementales(null); setDetalle(null); setPerfil(null);
    try {
      const params = Object.fromEntries(Object.entries(filtros).filter(([, valor]) => valor));
      const [datos, toros] = await Promise.all([api.obtenerAnaliticaReproductiva(params), api.listarSementalesReproductivos(params)]);
      setResumen(datos); setSementales(toros);
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { cargar(); }, [filtros.periodo, filtros.desde, filtros.hasta]); // eslint-disable-line react-hooks/exhaustive-deps

  async function abrirDetalle(clave) {
    try { setDetalle(await api.obtenerDetalleMetricaReproductiva(clave, Object.fromEntries(Object.entries(filtros).filter(([, valor]) => valor)))); }
    catch (err) { setError(err.message); }
  }
  async function abrirSemental(id) {
    try { const params = Object.fromEntries(Object.entries(filtros).filter(([, valor]) => valor)); const [respuesta, economia] = await Promise.all([api.obtenerPerfilSemental(id, params), tienePermiso(usuario?.rol, 'costos_reproductivos', 'leer') ? api.obtenerEconomiaSemental(id, params) : Promise.resolve(null)]); setPerfil(respuesta.item ? { ...respuesta.item, economia } : null); }
    catch (err) { setError(err.message); }
  }

  return <section className="repro-analysis" aria-labelledby="repro-analysis-title">
    <header><div><span>Datos explicables</span><h2 id="repro-analysis-title">Análisis reproductivo</h2><p>Cada cifra muestra su muestra, exclusiones y nivel de completitud.</p></div><FiltrosPeriodo filtros={filtros} onChange={setFiltros} /></header>
    {error && <EstadoError mensaje={`No se pudo cargar el análisis (${error}).`} onReintentar={cargar} />}
    {!error && !resumen && <EstadoCarga mensaje="Calculando indicadores reproductivos…" />}
    {resumen && <>
      <div className="repro-analysis-grid">{METRICAS_VISIBLES.map((clave) => {
        const metrica = resumen.metrics[clave]; const { Icono, ayuda } = PRESENTACION[clave];
        return <button type="button" className="repro-analysis-card" key={clave} onClick={() => abrirDetalle(clave)}><Icono aria-hidden="true" /><span>{metrica.etiqueta}</span><strong>{textoValor(metrica)}</strong><small>{contextoMetrica(metrica)}</small><p>{ayuda}</p>{metrica.excluidos > 0 && <em>{metrica.excluidos} excluido(s) por evidencia insuficiente</em>}</button>;
      })}</div>
      <div className="repro-attribution"><p><strong>{resumen.attribution.servicios_con_toro.porcentaje ?? 0} %</strong> de los servicios tienen toro identificado · {resumen.attribution.servicios_con_toro.sin_atribuir} sin atribuir.</p><p><strong>{resumen.attribution.gestaciones_con_servicio_y_toro.porcentaje ?? 0} %</strong> de las gestaciones confirmadas tienen servicio y toro atribuibles.</p></div>
      <DetalleMetrica detalle={detalle} onCerrar={() => setDetalle(null)} onAbrirSeguimiento={onAbrirSeguimiento} />
      <section className="repro-sires"><header><div><span>Muestra y evidencia</span><h3>Sementales</h3><p>No se asignan rankings: compara servicios, diagnósticos y tamaño de muestra.</p></div></header>{sementales?.items?.length ? <div className="repro-sire-list">{sementales.items.map((toro) => <button type="button" key={toro.id} onClick={() => abrirSemental(toro.id)}><div><strong>#{toro.arete}</strong><span>{toro.nombre || 'Sin alias'}</span></div><dl><div><dt>Servicios</dt><dd>{toro.servicios}</dd></div><div><dt>Diagnósticos</dt><dd>{toro.diagnosticos_positivos + toro.diagnosticos_negativos + toro.diagnosticos_dudosos}</dd></div><div><dt>Preñadas</dt><dd>{toro.diagnosticos_positivos}</dd></div><div><dt>Porcentaje</dt><dd>{toro.porcentaje_prenez == null ? '—' : `${toro.porcentaje_prenez} %`}</dd></div></dl></button>)}</div> : <EstadoVacio titulo="No hay servicios atribuibles a sementales en este periodo." compacto />}</section>
      <PerfilSemental perfil={perfil} onCerrar={() => setPerfil(null)} onAbrirSeguimiento={onAbrirSeguimiento} />
    </>}
  </section>;
}
