import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { leerExcelReproduccion, exportarReproduccionExcel } from '../exportUtils.js';
import { CAMPOS_REPRODUCCION_EXCEL, normalizarFilasReproductivas, nuevoIdLote, sugerirMapeoReproductivo } from '../reproduccionImport.js';
import { validarTamanoExcel } from '../excelSecurity.js';
import { mostrarError, mostrarExito } from '../feedbackOperacion.js';

const HOY = new Date().toISOString().slice(0, 10);
const FLUJOS = {
  servicios: { singular: 'Servicio', ayuda: 'Registra fecha, tipo y toro cuando corresponda.' },
  diagnosticos: { singular: 'Diagnóstico / palpación', ayuda: 'Marca Preñada, Vacía o Dudosa con su método.' },
  partos: { singular: 'Parto', ayuda: 'Registra parto, aborto o pérdida en ciclos compatibles.' },
};

function payloadFila(tipo, comun, captura, fila) {
  const base = { fila, arete_vaca: captura.arete_vaca, responsable_id: comun.responsable_id || undefined, observaciones: captura.observaciones };
  if (tipo === 'servicios') return { ...base, fecha: comun.fecha, tipo: captura.tipo_servicio, arete_toro: captura.arete_toro };
  if (tipo === 'diagnosticos') return { ...base, fecha: comun.fecha, resultado: captura.resultado_diagnostico, metodo: captura.metodo };
  return { ...base, fecha: comun.fecha, resultado: captura.resultado_parto };
}

function ResumenValidacion({ analisis }) {
  if (!analisis) return null;
  return <section className="repro-batch-preview" aria-live="polite">
    <header><h3>Vista previa</h3><span>{analisis.resumen.total} filas</span></header>
    <div className="repro-batch-counts"><b>{analisis.resumen.validas} válidas</b><b>{analisis.resumen.advertencias} con advertencias</b><b>{analisis.resumen.errores} con errores</b><b>{analisis.resumen.duplicados} duplicadas</b></div>
    <div className="repro-batch-row-list">{analisis.filas.map((fila) => <article key={fila.fila} className={fila.errores.length ? 'is-error' : fila.advertencias.length ? 'is-warning' : 'is-valid'}>
      <header><strong>Fila {fila.fila} · #{fila.datos.arete_vaca || 'Sin arete'}</strong><span>{fila.errores.length ? 'Corregir' : fila.advertencias.length ? 'Revisar' : 'Lista'}</span></header>
      {fila.errores.map((error) => <p key={`${error.codigo}-${error.campo || ''}`}>{error.mensaje}</p>)}
      {fila.advertencias.map((aviso) => <p key={aviso.codigo}>{aviso.mensaje}</p>)}
      {!fila.errores.length && !fila.advertencias.length && <p>La fila es compatible con el modelo reproductivo.</p>}
    </article>)}</div>
  </section>;
}

function CapturaMasiva({ responsables, onTerminar }) {
  const [tipo, setTipo] = useState('diagnosticos');
  const [comun, setComun] = useState({ fecha: HOY, responsable_id: '' });
  const vacia = { arete_vaca: '', arete_toro: '', tipo_servicio: 'natural', resultado_diagnostico: 'prenada', metodo: 'palpacion', resultado_parto: 'parto', observaciones: '' };
  const [captura, setCaptura] = useState(vacia); const [filas, setFilas] = useState([]);
  const [analisis, setAnalisis] = useState(null); const [ocupado, setOcupado] = useState(false);
  const [idLote, setIdLote] = useState(nuevoIdLote);
  useEffect(() => { setFilas([]); setAnalisis(null); setIdLote(nuevoIdLote()); setCaptura(vacia); }, [tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  function agregar() {
    if (!captura.arete_vaca.trim()) return mostrarError('Escribe el arete antes de agregar la fila.');
    setFilas((actual) => [...actual, payloadFila(tipo, comun, captura, actual.length + 1)]);
    setCaptura({ ...vacia }); setAnalisis(null);
    requestAnimationFrame(() => document.querySelector('#repro-arete-rapido')?.focus());
  }
  const payload = { import_batch_id: idLote, modo: 'captura', tipo_lote: tipo, filas };
  async function validar(confirmar = false) {
    if (!filas.length) return mostrarError('Agrega al menos un animal al lote.');
    setOcupado(true);
    try {
      const resultado = await api.validarLoteReproductivo(payload); setAnalisis(resultado);
      if (confirmar && resultado.puede_confirmar) {
        const aplicado = await api.confirmarLoteReproductivo(payload);
        mostrarExito(`${aplicado.total} registros guardados en un solo lote.`); onTerminar();
      }
    } catch (error) { mostrarError(error.message); } finally { setOcupado(false); }
  }

  return <div className="repro-batch-flow">
    <div className="repro-batch-step"><b>1</b><div><h3>¿Qué vas a registrar?</h3><div className="repro-batch-kind">{Object.entries(FLUJOS).map(([id, flujo]) => <button type="button" key={id} className={tipo === id ? 'is-active' : ''} onClick={() => setTipo(id)}>{flujo.singular}</button>)}</div></div></div>
    <div className="repro-batch-step"><b>2</b><div><h3>Datos comunes</h3><div className="repro-batch-common"><label>Fecha<input type="date" max={HOY} value={comun.fecha} onChange={(e) => setComun({ ...comun, fecha: e.target.value })} /></label><label>Responsable<select value={comun.responsable_id} onChange={(e) => setComun({ ...comun, responsable_id: e.target.value })}><option value="">Sin registrar</option>{responsables.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></label></div></div></div>
    <div className="repro-batch-step"><b>3</b><div><h3>Arete → acción → siguiente</h3><p>{FLUJOS[tipo].ayuda}</p><div className="repro-rapid-card">
      <label className="repro-rapid-ear">Arete de la vaca<input id="repro-arete-rapido" value={captura.arete_vaca} onChange={(e) => setCaptura({ ...captura, arete_vaca: e.target.value })} /></label>
      {tipo === 'servicios' && <><label>Tipo<select value={captura.tipo_servicio} onChange={(e) => setCaptura({ ...captura, tipo_servicio: e.target.value })}><option value="natural">Natural</option><option value="inseminacion_artificial">Inseminación artificial</option><option value="otro">Otro</option></select></label><label>Arete del toro<input value={captura.arete_toro} onChange={(e) => setCaptura({ ...captura, arete_toro: e.target.value })} placeholder="Opcional" /></label></>}
      {tipo === 'diagnosticos' && <><fieldset><legend>Resultado</legend><div className="repro-large-choices">{[['prenada','Preñada'],['vacia','Vacía'],['dudoso','Dudosa']].map(([id, etiqueta]) => <button type="button" key={id} className={captura.resultado_diagnostico === id ? 'is-active' : ''} onClick={() => setCaptura({ ...captura, resultado_diagnostico: id })}>{etiqueta}</button>)}</div></fieldset><label>Método<select value={captura.metodo} onChange={(e) => setCaptura({ ...captura, metodo: e.target.value })}><option value="palpacion">Palpación</option><option value="ecografia">Ultrasonido</option><option value="otro">Otro</option></select></label></>}
      {tipo === 'partos' && <fieldset><legend>Resultado</legend><div className="repro-large-choices">{[['parto','Parto'],['aborto','Aborto'],['perdida','Pérdida']].map(([id, etiqueta]) => <button type="button" key={id} className={captura.resultado_parto === id ? 'is-active' : ''} onClick={() => setCaptura({ ...captura, resultado_parto: id })}>{etiqueta}</button>)}</div></fieldset>}
      <label className="repro-rapid-notes">Observación<input value={captura.observaciones} onChange={(e) => setCaptura({ ...captura, observaciones: e.target.value })} placeholder="Opcional" /></label>
      <button type="button" className="btn btn-primary repro-next-animal" onClick={agregar}>Guardar en lote y siguiente animal</button>
    </div></div></div>
    {filas.length > 0 && <section className="repro-batch-queued"><header><h3>Lote en preparación</h3><strong>{filas.length}</strong></header>{filas.map((fila, indice) => <article key={indice}><span>#{fila.arete_vaca}</span><small>{fila.resultado || fila.tipo}</small><button type="button" onClick={() => { setFilas(filas.filter((_, i) => i !== indice).map((f, i) => ({ ...f, fila: i + 1 }))); setAnalisis(null); }}>Quitar</button></article>)}</section>}
    <ResumenValidacion analisis={analisis} />
    <div className="repro-batch-actions"><button type="button" className="btn btn-ghost" disabled={ocupado || !filas.length} onClick={() => validar(false)}>Revisar lote</button><button type="button" className="btn btn-primary" disabled={ocupado || !analisis?.puede_confirmar} onClick={() => validar(true)}>Confirmar lote completo</button></div>
  </div>;
}

function ImportacionExcel({ responsables, onTerminar }) {
  const [libro, setLibro] = useState(null); const [mapeo, setMapeo] = useState({});
  const [responsableId, setResponsableId] = useState(''); const [analisis, setAnalisis] = useState(null);
  const [idLote, setIdLote] = useState(nuevoIdLote); const [ocupado, setOcupado] = useState(false);
  const normalizadas = useMemo(() => libro ? normalizarFilasReproductivas(libro.filas, mapeo, libro.fechaATexto).map((f) => ({ ...f, responsable_id: responsableId || undefined })) : [], [libro, mapeo, responsableId]);
  const paso = !libro ? 1 : !analisis ? 2 : 5;

  async function cargar(event) {
    const archivo = event.target.files?.[0]; if (!archivo) return;
    try {
      const errorTamano = validarTamanoExcel(archivo.size); if (errorTamano) throw new Error(errorTamano);
      const leido = await leerExcelReproduccion(await archivo.arrayBuffer());
      setLibro({ ...leido, nombre: archivo.name }); setMapeo(sugerirMapeoReproductivo(leido.encabezados)); setAnalisis(null); setIdLote(nuevoIdLote());
    } catch (error) { mostrarError(`No se pudo leer el Excel: ${error.message}`); }
  }
  const payload = { import_batch_id: idLote, modo: 'importacion', tipo_lote: 'historico', nombre_archivo: libro?.nombre, mapeo, filas: normalizadas };
  async function validar() { setOcupado(true); try { setAnalisis(await api.validarLoteReproductivo(payload)); } catch (e) { mostrarError(e.message); } finally { setOcupado(false); } }
  async function confirmar() { setOcupado(true); try { const r = await api.confirmarLoteReproductivo(payload); mostrarExito(r.repetido ? 'Este lote ya había sido importado; no se duplicó.' : `${r.total} filas importadas sin duplicados.`); onTerminar(); } catch (e) { mostrarError(e.message); } finally { setOcupado(false); } }

  return <div className="repro-import-flow">
    <ol className="repro-import-progress" aria-label="Progreso de importación">{['Cargar archivo','Mapear columnas','Normalizar','Validar','Vista previa','Confirmar','Importar'].map((texto, i) => <li key={texto} className={paso >= i + 1 ? 'is-active' : ''}>{i + 1}<span>{texto}</span></li>)}</ol>
    <section className="repro-import-upload"><h3>1. Cargar archivo</h3><p>El archivo no necesita encabezados exactos. Máximo 5 MB y 2,000 filas por lote.</p><input type="file" accept=".xlsx" onChange={cargar} /></section>
    {libro && <><section className="repro-import-map"><h3>2. Mapear columnas</h3><p>Indica qué significa cada columna. Las columnas extras se ignoran.</p><div>{CAMPOS_REPRODUCCION_EXCEL.map(([campo, etiqueta]) => <label key={campo}><span>{etiqueta}{campo === 'arete_vaca' ? ' *' : ''}</span><select value={mapeo[campo] ?? ''} onChange={(e) => { setMapeo({ ...mapeo, [campo]: e.target.value }); setAnalisis(null); }}><option value="">No incluida</option>{libro.encabezados.map((h, i) => <option key={`${h}-${i}`} value={i}>{h}</option>)}</select></label>)}</div><label>Responsable común<select value={responsableId} onChange={(e) => { setResponsableId(e.target.value); setAnalisis(null); }}><option value="">Sin registrar</option>{responsables.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></label></section>
      <section className="repro-import-normalized"><h3>3–4. Normalizar y validar</h3><p>{normalizadas.length} filas detectadas. No se escribirá nada durante esta revisión.</p><button type="button" className="btn btn-primary" disabled={ocupado || !normalizadas.length || !mapeo.arete_vaca} onClick={validar}>Validar archivo completo</button></section></>}
    <ResumenValidacion analisis={analisis} />
    {analisis && <div className="repro-batch-actions"><p>{analisis.puede_confirmar ? 'Todas las filas pueden importarse. Las advertencias se conservarán sin inventar datos.' : 'Corrige el Excel o el mapeo y vuelve a validar.'}</p><button type="button" className="btn btn-primary" disabled={ocupado || !analisis.puede_confirmar} onClick={confirmar}>Confirmar e importar todo</button></div>}
  </div>;
}

function ExportacionReproductiva() {
  const [filtros, setFiltros] = useState({ tipo: 'todos', arete: '', desde: '', hasta: '', ciclo_id: '' }); const [ocupado, setOcupado] = useState(false);
  async function exportar() { setOcupado(true); try { const datos = await api.exportarReproduccion(filtros); await exportarReproduccionExcel(datos, `reproduccion-${filtros.tipo}`); mostrarExito('Exportación reproductiva preparada.'); } catch (e) { mostrarError(e.message); } finally { setOcupado(false); } }
  return <section className="repro-export"><h3>Exportación reproductiva</h3><p>Elige animal, periodo, ciclo o tipo de evento. El archivo usa nombres de campo comprensibles.</p><div><label>Contenido<select value={filtros.tipo} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}><option value="todos">Modelo completo</option><option value="ciclos">Ciclos</option><option value="servicios">Servicios</option><option value="diagnosticos">Diagnósticos</option><option value="partos">Partos</option></select></label><label>Arete<input value={filtros.arete} onChange={(e) => setFiltros({ ...filtros, arete: e.target.value })} placeholder="Todos" /></label><label>Desde<input type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} /></label><label>Hasta<input type="date" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} /></label><label>Ciclo<input inputMode="numeric" value={filtros.ciclo_id} onChange={(e) => setFiltros({ ...filtros, ciclo_id: e.target.value })} placeholder="Todos" /></label></div><button type="button" className="btn btn-primary" disabled={ocupado} onClick={exportar}>{ocupado ? 'Preparando…' : 'Exportar Excel'}</button></section>;
}

export default function ReproduccionMasiva({ modoInicial = 'captura', onCerrar, onTerminar }) {
  const [modo, setModo] = useState(modoInicial); const [responsables, setResponsables] = useState([]);
  useEffect(() => { api.listarResponsablesReproduccion().then(setResponsables).catch(() => setResponsables([])); }, []);
  return <section className="repro-bulk-workspace"><header><div><span>Trabajo rápido</span><h2>{modo === 'captura' ? 'Captura masiva' : modo === 'importacion' ? 'Importación histórica' : 'Exportar reproducción'}</h2></div><button type="button" className="btn btn-ghost" onClick={onCerrar}>Cerrar</button></header><nav aria-label="Herramientas reproductivas"><button type="button" className={modo === 'captura' ? 'is-active' : ''} onClick={() => setModo('captura')}>Captura masiva</button><button type="button" className={modo === 'importacion' ? 'is-active' : ''} onClick={() => setModo('importacion')}>Importar Excel</button><button type="button" className={modo === 'exportacion' ? 'is-active' : ''} onClick={() => setModo('exportacion')}>Exportar</button></nav>{modo === 'captura' ? <CapturaMasiva responsables={responsables} onTerminar={onTerminar} /> : modo === 'importacion' ? <ImportacionExcel responsables={responsables} onTerminar={onTerminar} /> : <ExportacionReproductiva />}</section>;
}
