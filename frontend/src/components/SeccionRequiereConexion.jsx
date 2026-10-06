import { EstadoVacio } from './EstadosUI.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { comprobarConectividadReal } from '../offline/connectivity.js';
import { formatearAntiguedad } from '../offline/formatoTiempo.js';

// Offline v1 Fase B §9: fallback reutilizable para cualquier módulo sin
// soporte de lectura offline. Nunca muestra el error técnico real del
// fetch (el usuario no llega a intentarlo: esta pantalla lo reemplaza
// antes) y nunca oculta el módulo como si no existiera para su rol —
// solo indica que necesita red.
export default function SeccionRequiereConexion({ descripcion }) {
  const { metadatosSync } = useAuth();
  const antiguedad = formatearAntiguedad(metadatosSync?.ultima_sincronizacion_exitosa);
  return (
    <EstadoVacio
      titulo="Esta sección necesita conexión"
      descripcion={`${descripcion || 'Sin Internet solo puedes consultar Inicio, Animales, Corrales y Tareas con la información ya sincronizada en este dispositivo.'}${antiguedad ? ` Última sincronización: ${antiguedad}.` : ''}`}
      accion={<button type="button" className="btn btn-ghost" onClick={() => comprobarConectividadReal()}>Comprobar conexión</button>}
    />
  );
}
