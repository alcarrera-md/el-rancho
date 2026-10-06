import { ACCIONES_CAMPO, MENSAJES_ACCION } from '../fieldActions.js';
import CambiarEstadoSaludModal from './CambiarEstadoSaludModal.jsx';
import MoverAnimalModal from './MoverAnimalModal.jsx';
import NotaRapidaModal from './NotaRapidaModal.jsx';
import RegistrarAlimentacionModal from './RegistrarAlimentacionModal.jsx';
import RegistrarCondicionModal from './RegistrarCondicionModal.jsx';
import RegistrarLecheModal from './RegistrarLecheModal.jsx';
import RegistrarPesajeModal from './RegistrarPesajeModal.jsx';
import RegistrarSaludModal from './RegistrarSaludModal.jsx';

export default function FlujoAccionAnimal({ animal, accion, onCerrar, onCompletado }) {
  function completar(resultado) {
    const mensaje = resultado?.offline_pending
      ? 'Guardado en este dispositivo. Pendiente de sincronización.'
      : MENSAJES_ACCION[accion] || 'Registro guardado correctamente.';
    onCompletado(mensaje, resultado);
  }

  const comunes = { animalId: animal.id, animal, onCerrar, onCreado: completar };
  if (accion === ACCIONES_CAMPO.PESAJE) return <RegistrarPesajeModal {...comunes} />;
  if (accion === ACCIONES_CAMPO.ALIMENTACION) return <RegistrarAlimentacionModal {...comunes} />;
  if (accion === ACCIONES_CAMPO.OBSERVACION) return <CambiarEstadoSaludModal animal={animal} soloObservacion onCerrar={onCerrar} onGuardado={completar} />;
  if (accion === ACCIONES_CAMPO.SALUD) return <RegistrarSaludModal {...comunes} />;
  if (accion === ACCIONES_CAMPO.MOVER) return <MoverAnimalModal animal={animal} onCerrar={onCerrar} onCreado={completar} />;
  if (accion === ACCIONES_CAMPO.LECHE) return <RegistrarLecheModal {...comunes} />;
  if (accion === ACCIONES_CAMPO.NOTA) return <NotaRapidaModal animal={animal} onCerrar={onCerrar} onCreado={completar} />;
  if (accion === ACCIONES_CAMPO.CONDICION) return <RegistrarCondicionModal {...comunes} />;
  return null;
}
