import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CircleAlert, Info, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
import { api } from '../api';
import { IconoEnviar, IconoCerrar } from './Iconos.jsx';

const SUGERENCIAS = ['¿Cómo va el rancho hoy?', '¿Qué animales necesitan atención?', '¿Cuántas vacas tengo?', '¿Qué tareas tengo pendientes?'];

// Avisos que el backend agrega a una respuesta: se distinguen solo para
// presentarlos; el texto se muestra íntegro.
function tipoAviso(texto) {
  if (/no estuvo disponible/i.test(texto)) return 'degradado';
  return 'nota';
}

function renderizarTexto(texto) {
  return texto.split('\n').map((linea, i) => {
    if (!linea.trim()) return <span key={i} className="chat-texto-espacio" aria-hidden="true" />;
    const partes = linea.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={i} className="chat-texto-linea">
        {partes.map((parte, j) =>
          parte.startsWith('**') && parte.endsWith('**')
            ? <strong key={j}>{parte.slice(2, -2)}</strong>
            : <span key={j}>{parte}</span>
        )}
      </span>
    );
  });
}

function AvatarAsistente({ tamano = 'normal' }) {
  return (
    <span className={`chat-avatar chat-avatar-${tamano}`} aria-hidden="true">
      <Sparkles width={tamano === 'grande' ? 26 : 15} height={tamano === 'grande' ? 26 : 15} strokeWidth={1.8} />
    </span>
  );
}

export default function ChatFlotante() {
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState([]);
  const [contexto, setContexto] = useState(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const finRef = useRef(null);
  const entradaRef = useRef(null);
  const lanzadorRef = useRef(null);
  const panelRef = useRef(null);
  const tituloId = useId();
  const devolverFoco = useRef(false);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensajes, abierto, enviando]);

  // Al abrir, el foco va al campo de escritura; Escape cierra y devuelve el
  // foco al botón que abrió el asistente.
  useEffect(() => {
    if (!abierto) return undefined;
    entradaRef.current?.focus();
    const alPresionar = (evento) => {
      if (evento.key === 'Escape') {
        evento.stopPropagation();
        cerrar();
      }
    };
    document.addEventListener('keydown', alPresionar);
    return () => document.removeEventListener('keydown', alPresionar);
  }, [abierto]);

  // Móvil: el teclado reduce el área visible; el panel se ajusta a ella para
  // que el campo de escritura siga a la vista.
  useEffect(() => {
    const vista = window.visualViewport;
    if (!abierto || !vista) return undefined;
    const ajustar = () => panelRef.current?.style.setProperty('--chat-vista-alto', `${Math.round(vista.height)}px`);
    ajustar();
    vista.addEventListener('resize', ajustar);
    return () => vista.removeEventListener('resize', ajustar);
  }, [abierto]);

  // El foco vuelve al lanzador después del render que lo muestra de nuevo
  // (en móvil está oculto mientras el panel está abierto).
  useEffect(() => {
    if (abierto || !devolverFoco.current) return;
    devolverFoco.current = false;
    lanzadorRef.current?.focus();
  }, [abierto]);

  function cerrar() {
    devolverFoco.current = true;
    setAbierto(false);
  }

  function agregarMensaje(msg) {
    setMensajes((m) => [...m, msg]);
  }

  function nuevaConversacion() {
    setMensajes([]);
    setContexto(null);
    setTexto('');
    entradaRef.current?.focus();
  }

  // "mostrado" permite enviar el valor de una opción (p. ej. el arete) y
  // mostrar su etiqueta legible en la conversación.
  async function enviar(mensajeForzado, mostrado) {
    const contenido = (mensajeForzado ?? texto).trim();
    if (!contenido || enviando) return;

    // Solo contexto breve: los últimos turnos válidos, sin mensajes de error.
    const historial = mensajes
      .filter((m) => (m.rol === 'usuario' || m.rol === 'asistente') && !m.error && m.texto?.trim())
      .slice(-8)
      .map((m) => ({ rol: m.rol, texto: m.texto.trim().slice(0, 1200) }));

    agregarMensaje({ rol: 'usuario', texto: mostrado || contenido });
    setTexto('');
    setEnviando(true);

    try {
      const data = await api.consultarAsistente(contenido, historial, contexto);
      setContexto(data.contexto || null);
      agregarMensaje({
        rol: 'asistente', texto: data.texto, destacado: data.destacado, lista: data.lista,
        tabla: data.tabla, advertencia: data.advertencia, acciones: data.acciones || [], opciones: data.opciones || [],
      });
    } catch (err) {
      agregarMensaje({ rol: 'asistente', texto: `No pude responder: ${err.message}`, error: true });
    } finally {
      setEnviando(false);
    }
  }

  async function ejecutarAccion(indice, accion) {
    if (accion.tipo === 'enlace_interno') {
      setAbierto(false);
      navigate(accion.ruta);
      return;
    }
    if (accion.tipo !== 'drill_down_reproductivo') return;
    setEnviando(true);
    try {
      const detalle = await api.obtenerDetalleMetricaReproductiva(accion.metrica, { ...accion.filtros, limite: 25 });
      setMensajes((actuales) => actuales.map((mensaje, posicion) => (posicion === indice ? { ...mensaje, detalle } : mensaje)));
    } catch (err) {
      setMensajes((actuales) => actuales.map((mensaje, posicion) => (posicion === indice ? { ...mensaje, detalleError: err.message } : mensaje)));
    } finally { setEnviando(false); }
  }

  return (
    <>
      {abierto && (
        <section ref={panelRef} className="chat-panel" role="dialog" aria-modal="false" aria-labelledby={tituloId}>
          <header className="chat-panel-header">
            <AvatarAsistente />
            <div className="chat-panel-titulo">
              <strong id={tituloId}>Asistente El Rancho</strong>
              <span><i className="chat-estado-punto" aria-hidden="true" />Datos verificados de tu rancho</span>
            </div>
            {mensajes.length > 0 && (
              <button type="button" className="chat-header-boton" onClick={nuevaConversacion} aria-label="Nueva conversación" title="Nueva conversación">
                <RotateCcw width={16} height={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
            <button type="button" className="chat-header-boton chat-cerrar" onClick={cerrar} aria-label="Cerrar asistente" title="Cerrar (Esc)">
              <IconoCerrar width={17} height={17} />
            </button>
          </header>

          <div className="chat-mensajes" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversación con el asistente">
            {mensajes.length === 0 && (
              <div className="chat-vacio">
                <AvatarAsistente tamano="grande" />
                <h2>Asistente El Rancho</h2>
                <p>Consulta información de tus animales, salud, tareas, reproducción, inventario y más.</p>
                <div className="chat-sugerencias" role="group" aria-label="Preguntas sugeridas">
                  {SUGERENCIAS.map((s) => (
                    <button type="button" key={s} className="chat-sugerencia" onClick={() => enviar(s)}>
                      <span>{s}</span>
                      <ArrowRight width={14} height={14} strokeWidth={2} aria-hidden="true" />
                    </button>
                  ))}
                </div>
                <small className="chat-vacio-nota">Solo consulta datos: no modifica registros.</small>
              </div>
            )}
            {mensajes.map((m, i) => (
              <div key={i} className={`chat-fila ${m.rol === 'usuario' ? 'chat-fila-usuario' : 'chat-fila-asistente'}`}>
                {m.rol !== 'usuario' && (m.error
                  ? <span className="chat-avatar chat-avatar-error" aria-hidden="true"><CircleAlert width={15} height={15} strokeWidth={1.9} /></span>
                  : <AvatarAsistente />)}
                <div className={`chat-burbuja ${m.rol === 'usuario' ? 'chat-burbuja-usuario' : 'chat-burbuja-asistente'} ${m.error ? 'chat-burbuja-error' : ''}`}>
                  <span className="sr-only">{m.rol === 'usuario' ? 'Tú:' : 'Asistente:'}</span>
                  {renderizarTexto(m.texto)}
                  {m.destacado && <div className="chat-highlight"><strong>{m.destacado.valor}</strong><span className="chat-highlight-sep" aria-hidden="true">·</span><span>{m.destacado.etiqueta}</span></div>}
                  {m.opciones?.length > 0 && i === mensajes.length - 1
                    ? <div className="chat-actions chat-opciones" role="group" aria-label="Elige una opción">{m.opciones.map((opcion) => <button type="button" className="chat-opcion" key={opcion.valor} disabled={enviando} onClick={() => enviar(opcion.valor, opcion.etiqueta)}>{opcion.etiqueta}</button>)}</div>
                    : m.lista?.length > 0 && <ul className="chat-list">{m.lista.map((item, j) => <li key={j}>{item}</li>)}</ul>}
                  {m.tabla?.filas?.length > 0 && <div className="chat-table-wrap"><table><thead><tr>{m.tabla.columnas.map((columna) => <th key={columna} scope="col">{columna}</th>)}</tr></thead><tbody>{m.tabla.filas.map((fila, j) => <tr key={j}>{fila.map((celda, k) => <td key={k}>{celda ?? '—'}</td>)}</tr>)}</tbody></table></div>}
                  {m.advertencia && (
                    <div className={`chat-warning chat-aviso-${tipoAviso(m.advertencia)}`} role="note">
                      {tipoAviso(m.advertencia) === 'degradado'
                        ? <TriangleAlert width={14} height={14} strokeWidth={2} aria-hidden="true" />
                        : <Info width={14} height={14} strokeWidth={2} aria-hidden="true" />}
                      <span>{m.advertencia}</span>
                    </div>
                  )}
                  {m.acciones?.length > 0 && <ul className="chat-actions" aria-label="Ver detalle">{m.acciones.map((accion, j) => <li key={`${accion.tipo}-${accion.ruta}-${accion.metrica || ''}-${j}`}><button type="button" className="chat-accion" onClick={() => ejecutarAccion(i, accion)}><span>{accion.etiqueta}</span><ArrowRight width={13} height={13} strokeWidth={2.1} aria-hidden="true" /></button></li>)}</ul>}
                  {m.detalle && <div className="chat-drilldown"><strong>{m.detalle.total} registro(s)</strong>{m.detalle.items.length ? <ul>{m.detalle.items.map((item, j) => <li key={`${item.ciclo_id}-${j}`}><button type="button" onClick={() => { setAbierto(false); navigate(`/animales/${item.animal_id}/seguimiento?seccion=reproduccion`); }}>#{item.arete}</button>{item.animal ? ` · ${item.animal}` : ''}</li>)}</ul> : <span>No hay registros para mostrar.</span>}{m.detalle.has_more && <small>Hay más resultados; abre Reproducción para continuar.</small>}</div>}
                  {m.detalleError && <div className="chat-warning chat-aviso-error" role="note"><CircleAlert width={14} height={14} strokeWidth={2} aria-hidden="true" /><span>No se pudo abrir el detalle: {m.detalleError}</span></div>}
                </div>
              </div>
            ))}
            {enviando && (
              <div className="chat-fila chat-fila-asistente">
                <AvatarAsistente />
                <div className="chat-burbuja chat-burbuja-asistente chat-escribiendo" role="status">
                  <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
                  <span className="sr-only">Consultando los datos del rancho…</span>
                </div>
              </div>
            )}
            <div ref={finRef} />
          </div>

          <form className="chat-input-row" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
            <label className="sr-only" htmlFor={`${tituloId}-entrada`}>Escribe tu pregunta al asistente</label>
            <input
              ref={entradaRef} id={`${tituloId}-entrada`}
              className="chat-entrada" placeholder="Pregunta sobre tu rancho…" value={texto}
              onChange={(e) => setTexto(e.target.value)} autoComplete="off" enterKeyHint="send" maxLength={1000}
            />
            <button type="submit" className="chat-enviar" disabled={enviando || !texto.trim()} aria-label="Enviar pregunta">
              <IconoEnviar width={17} height={17} />
            </button>
          </form>
        </section>
      )}

      <button
        ref={lanzadorRef} type="button"
        className={`chat-boton-flotante ${abierto ? 'is-abierto' : ''}`}
        onClick={() => (abierto ? cerrar() : setAbierto(true))}
        title="Asistente El Rancho"
        aria-label={abierto ? 'Cerrar asistente del rancho' : 'Abrir asistente del rancho'}
        aria-expanded={abierto}
      >
        {abierto ? <IconoCerrar width={20} height={20} /> : <Sparkles width={20} height={20} strokeWidth={1.8} aria-hidden="true" />}
        <span className="chat-boton-texto" aria-hidden="true">{abierto ? 'Cerrar' : 'Asistente'}</span>
      </button>
    </>
  );
}
