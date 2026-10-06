import { atributosAnuncio } from '../accessibility.js';
import { IconoCheck } from './Iconos.jsx';

export function EstadoCarga({ mensaje = 'Cargando información…', compacto = false }) {
  return <div className={`ui-state ui-loading ${compacto ? 'compacto' : ''}`} {...atributosAnuncio('estado')}><span className="ui-loading-indicator" aria-hidden="true" />{mensaje}</div>;
}

export function EstadoVacio({ titulo, descripcion, accion, compacto = false }) {
  return (
    <div className={`ui-state ui-empty ${compacto ? 'compacto' : ''}`}>
      <h3>{titulo}</h3>
      {descripcion && <p>{descripcion}</p>}
      {accion}
    </div>
  );
}

export function EstadoError({ titulo = 'No se pudo completar la carga.', mensaje, onReintentar, textoReintentar = 'Reintentar', compacto = false }) {
  return (
    <div className={`ui-state ui-error ${compacto ? 'compacto' : ''}`} role="alert">
      <div>{titulo && <strong>{titulo}</strong>}<p>{mensaje}</p></div>
      {onReintentar && <button type="button" className="btn btn-ghost" onClick={onReintentar}>{textoReintentar}</button>}
    </div>
  );
}

export function FeedbackOperacion({ tipo = 'exito', mensaje, titulo }) {
  if (!mensaje) return null;
  return (
    <div className={`feedback-operacion feedback-${tipo}`} {...atributosAnuncio(tipo === 'error' ? 'error' : 'estado')}>
      {tipo === 'exito' && <span className="feedback-operacion-icono" aria-hidden="true"><IconoCheck width={18} height={18} /></span>}
      <span>{titulo && <strong>{titulo}</strong>}{mensaje}</span>
    </div>
  );
}
