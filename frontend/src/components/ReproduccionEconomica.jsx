import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';

const ETIQUETAS = {
  semen: 'Semen', inseminacion: 'Inseminación', monta_servicio: 'Monta / servicio', palpacion: 'Palpación',
  ultrasonido: 'Ultrasonido', veterinario: 'Veterinario', medicamento_insumo: 'Medicamento / insumo',
  procedimiento: 'Procedimiento', transporte: 'Transporte', otro: 'Otro',
};
const dinero = (valor) => valor == null ? 'Datos incompletos' : Number(valor).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

function Indicador({ titulo, valor, detalle }) {
  return <article className="repro-economic-kpi"><span>{titulo}</span><strong>{valor}</strong><small>{detalle}</small></article>;
}

export default function ReproduccionEconomica() {
  const { usuario } = useAuth();
  const [periodo, setPeriodo] = useState('anio_actual');
  const [resumen, setResumen] = useState(null);
  const [costos, setCostos] = useState(null);
  const [error, setError] = useState('');
  const puedeEliminar = tienePermiso(usuario?.rol, 'costos_reproductivos', 'eliminar');

  async function cargar() {
    setError(''); setResumen(null); setCostos(null);
    try {
      const [analitica, lista] = await Promise.all([api.obtenerAnaliticaCostosReproductivos({ periodo }), api.listarCostosReproductivos()]);
      setResumen(analitica); setCostos(lista);
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { cargar(); }, [periodo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function eliminar(id) {
    if (!window.confirm('¿Eliminar este costo reproductivo? La operación quedará auditada.')) return;
    try { await api.eliminarCostoReproductivo(id); await cargar(); } catch (err) { setError(err.message); }
  }

  return <section className="repro-economics" aria-labelledby="repro-economics-title">
    <header><div><span>Costos directos registrados</span><h2 id="repro-economics-title">Economía reproductiva</h2><p>Separa atribución reproductiva de flujo de caja y no estima importes ausentes.</p></div><label><span>Periodo</span><select value={periodo} onChange={(e) => setPeriodo(e.target.value)}><option value="mes_actual">Este mes</option><option value="anio_actual">Este año</option><option value="ultimos_30_dias">Últimos 30 días</option></select></label></header>
    {error && <EstadoError mensaje={`No se pudieron cargar los costos (${error}).`} onReintentar={cargar} />}
    {!error && !resumen && <EstadoCarga mensaje="Calculando costos reproductivos…" />}
    {resumen && <>
      <div className="repro-economic-grid">
        <Indicador titulo="Gasto reproductivo" valor={dinero(resumen.total)} detalle={`${resumen.registros} costo(s) registrados`} />
        <Indicador titulo="Costo por preñez" valor={dinero(resumen.costo_por_prenez.valor)} detalle={`${dinero(resumen.costo_por_prenez.numerador)} ÷ ${resumen.costo_por_prenez.denominador} preñez(es); ${resumen.costo_por_prenez.excluidos_abiertos + resumen.costo_por_prenez.excluidos_sin_prenez_confirmada} ciclo(s) excluido(s)`} />
        <Indicador titulo="Costo por parto" valor={dinero(resumen.costo_por_parto.valor)} detalle={`${dinero(resumen.costo_por_parto.numerador)} ÷ ${resumen.costo_por_parto.denominador} parto(s); ${resumen.costo_por_parto.excluidos_abiertos + resumen.costo_por_parto.excluidos_sin_parto_valido} ciclo(s) excluido(s)`} />
        <Indicador titulo="Ciclos con pérdidas" valor={String(resumen.perdidas.ciclos)} detalle={`${dinero(resumen.perdidas.costo_acumulado)} acumulado registrado`} />
      </div>
      {(resumen.costo_por_prenez.estado === 'datos_incompletos' || resumen.costo_por_parto.estado === 'datos_incompletos') && <div className="context-note" role="note"><strong>Datos incompletos.</strong> Los promedios necesitan ciclos cerrados con evidencia; {resumen.completitud.ciclos_abiertos_excluidos} ciclo(s) abierto(s) quedaron excluidos.</div>}
      <div className="repro-economic-breakdown"><article><h3>Por etapa</h3><dl><div><dt>Servicios</dt><dd>{dinero(resumen.desglose_etapa.servicios)} · promedio {dinero(resumen.costo_por_servicio.valor)}</dd></div><div><dt>Diagnósticos</dt><dd>{dinero(resumen.desglose_etapa.diagnosticos)} · promedio {dinero(resumen.costo_por_diagnostico.valor)}</dd></div><div><dt>Partos e incidencias</dt><dd>{dinero(resumen.desglose_etapa.partos)}</dd></div><div><dt>Otros directos</dt><dd>{dinero(resumen.desglose_etapa.otros)}</dd></div></dl><small>Servicios con costo: {resumen.costo_por_servicio.denominador} de {resumen.costo_por_servicio.total_eventos}. Diagnósticos con costo: {resumen.costo_por_diagnostico.denominador} de {resumen.costo_por_diagnostico.total_eventos}. Los promedios no convierten importes ausentes en $0.</small></article><article><h3>Procedencia y comparación</h3><p>{resumen.flujo_caja.ya_contabilizados} costo(s) referencian compras o gastos ya incluidos en caja.</p><p>{resumen.flujo_caja.costos_adicionales} costo(s) directos se incorporan como egreso adicional.</p><p>Periodo anterior: {dinero(resumen.comparacion_periodo_anterior.total)}. Diferencia: {dinero(resumen.comparacion_periodo_anterior.diferencia)}.</p></article></div>
      {!!resumen.por_ciclo.length && <section className="repro-cycle-costs"><h3>Costo acumulado por ciclo</h3><div>{resumen.por_ciclo.map((ciclo) => <article key={ciclo.ciclo_id}><header><div><strong>#{ciclo.arete_id} · ciclo {ciclo.ciclo_id}</strong><span>{ciclo.nombre_alias || 'Sin alias'} · {ciclo.fecha_cierre ? ciclo.resultado_final : 'Ciclo abierto'}</span></div><b>{dinero(ciclo.total)}</b></header><small>Servicios {dinero(ciclo.servicios)} · Diagnósticos {dinero(ciclo.diagnosticos)} · Parto/incidencias {dinero(ciclo.parto)} · Otros {dinero(ciclo.otros)}</small></article>)}</div></section>}
      <section className="repro-cost-list"><h3>Costos registrados recientemente</h3>{costos?.length ? costos.slice(0, 12).map((costo) => <article key={costo.id}><div><strong>{ETIQUETAS[costo.categoria] || costo.categoria}</strong><span>{costo.animal_arete ? `Animal #${costo.animal_arete}` : 'Atribución general'} · {String(costo.fecha).slice(0, 10)}</span></div><b>{dinero(costo.monto)}</b>{puedeEliminar && <button type="button" className="btn btn-ghost" onClick={() => eliminar(costo.id)}>Eliminar</button>}</article>) : <EstadoVacio titulo="No hay costos reproductivos registrados." descripcion="Los formularios de servicio, diagnóstico y parto permiten capturarlos de forma opcional." compacto />}</section>
    </>}
  </section>;
}
