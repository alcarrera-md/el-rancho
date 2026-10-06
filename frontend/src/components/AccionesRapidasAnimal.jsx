import { useAuth } from '../auth/AuthContext.jsx';
import { ACCIONES_CAMPO, accionesCampoDisponibles } from '../fieldActions.js';
import {
  IconoAnimal, IconoBalanza, IconoChat, IconoGota, IconoHoja, IconoLista, IconoMovimiento, IconoOjo, IconoSalud,
} from './Iconos.jsx';

const ICONOS = {
  [ACCIONES_CAMPO.ABRIR]: IconoOjo,
  [ACCIONES_CAMPO.PESAJE]: IconoBalanza,
  [ACCIONES_CAMPO.ALIMENTACION]: IconoHoja,
  [ACCIONES_CAMPO.OBSERVACION]: IconoOjo,
  [ACCIONES_CAMPO.SALUD]: IconoSalud,
  [ACCIONES_CAMPO.MOVER]: IconoMovimiento,
  [ACCIONES_CAMPO.LECHE]: IconoGota,
  [ACCIONES_CAMPO.NOTA]: IconoChat,
};

function BotonAccion({ accion, onAccion }) {
  const Icono = ICONOS[accion.id] || IconoAnimal;
  return (
    <button type="button" className="field-action" onClick={(evento) => { evento.stopPropagation(); onAccion(accion.id); }}>
      <Icono width={18} height={18} />
      <span>{accion.label}</span>
    </button>
  );
}

export default function AccionesRapidasAnimal({ animal, onAccion, compacto = false, incluirAbrir = false, accionesPermitidas = null }) {
  const { usuario } = useAuth();
  const permitidas = accionesPermitidas ? new Set(accionesPermitidas) : null;
  const acciones = accionesCampoDisponibles(usuario?.rol, animal, { incluirAbrir })
    .filter((accion) => !permitidas || permitidas.has(accion.id));
  if (acciones.length === 0) return null;

  const principales = compacto ? acciones.slice(0, 2) : acciones;
  const adicionales = compacto ? acciones.slice(2) : [];
  return (
    <div className={`field-actions ${compacto ? 'field-actions-compactas' : ''}`} role="group" aria-label={`Acciones rápidas para ${animal.arete_id}`} onClick={(evento) => evento.stopPropagation()}>
      {principales.map((accion) => <BotonAccion key={accion.id} accion={accion} onAccion={onAccion} />)}
      {adicionales.length > 0 && (
        <details className="field-actions-more">
          <summary onClick={(evento) => evento.stopPropagation()}><IconoLista width={18} height={18} aria-hidden="true" /><span>Más acciones</span></summary>
          <div>{adicionales.map((accion) => <BotonAccion key={accion.id} accion={accion} onAccion={onAccion} />)}</div>
        </details>
      )}
    </div>
  );
}
