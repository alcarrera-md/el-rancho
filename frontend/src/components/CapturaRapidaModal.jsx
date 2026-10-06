import { useEffect, useState } from 'react';
import { api } from '../api';
import AccionesRapidasAnimal from './AccionesRapidasAnimal.jsx';
import FlujoAccionAnimal from './FlujoAccionAnimal.jsx';
import ModalAccesible from './ModalAccesible.jsx';
import { EstadoCarga, EstadoError, EstadoVacio } from './EstadosUI.jsx';
import { exigirListaModulo } from '../monitoringUx.js';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { ACCIONES_CAMPO } from '../fieldActions.js';
import { ALMACEN_ANIMALES, leerColeccionLocal } from '../offline/campoDB.js';
import { CONECTIVIDAD_OFFLINE, obtenerEstadoConectividad } from '../offline/connectivity.js';

const ACCIONES_OFFLINE = [ACCIONES_CAMPO.PESAJE, ACCIONES_CAMPO.ALIMENTACION, ACCIONES_CAMPO.OBSERVACION, ACCIONES_CAMPO.SALUD, ACCIONES_CAMPO.CONDICION, ACCIONES_CAMPO.NOTA, ACCIONES_CAMPO.MOVER];

export default function CapturaRapidaModal({ accionInicial = null, onCerrar, onCompletado }) {
  const { usuario, estadoAutenticacion } = useAuth();
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || obtenerEstadoConectividad() === CONECTIVIDAD_OFFLINE;
  const [q, setQ] = useState('');
  const [animales, setAnimales] = useState(null);
  const [animal, setAnimal] = useState(null);
  const [accion, setAccion] = useState(null);
  const [error, setError] = useState(null);
  const [reintento, setReintento] = useState(0);

  useEffect(() => {
    if (animal) return undefined;
    const temporizador = setTimeout(() => {
      setError(null);
      const carga = sinConexion
        ? leerColeccionLocal(ALMACEN_ANIMALES, usuario?.id).then((local) => (local?.datos || []).filter((item) => item.estado === 'vivo' && (!q.trim() || `${item.arete_id} ${item.nombre_alias || ''}`.toLowerCase().includes(q.trim().toLowerCase()))))
        : api.listarAnimales({ estado: 'vivo', ...(q.trim() ? { q: q.trim() } : {}) });
      carga
        .then((data) => setAnimales(exigirListaModulo(data, sinConexion ? 'IndexedDB/animales_resumen' : '/api/animales?estado=vivo').slice(0, 8)))
        .catch((err) => setError(err.message));
    }, 220);
    return () => clearTimeout(temporizador);
  }, [q, animal, reintento, sinConexion, usuario?.id]);

  function seleccionar(seleccionado) {
    setAnimal(seleccionado);
    if (accionInicial && (!sinConexion || ACCIONES_OFFLINE.includes(accionInicial))) setAccion(accionInicial);
  }

  if (animal && accion) {
    return <FlujoAccionAnimal animal={animal} accion={accion} onCerrar={() => setAccion(null)} onCompletado={onCompletado} />;
  }

  return (
    <ModalAccesible titulo={animal ? '¿Qué deseas registrar?' : 'Captura rápida'} onCerrar={onCerrar} className="captura-rapida-modal">
        <div className="captura-header">
          <p>{animal ? 'El animal ya está seleccionado.' : 'Busca por arete o nombre. No tendrás que seleccionarlo otra vez.'}</p>
          <button className="modal-close-button" data-modal-cerrar onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>

        {error && <EstadoError mensaje={error} compacto onReintentar={() => setReintento((valor) => valor + 1)} />}
        {!animal ? (
          <>
            <label className="field">
              <span>Animal</span>
              <input className="input search-prominent" type="search" inputMode="search" autoComplete="off" data-autofocus value={q} onChange={(evento) => setQ(evento.target.value)} placeholder="Ej. MX-204 o Lucero" />
            </label>
            <div className="captura-resultados">
              {animales === null ? <EstadoCarga mensaje="Buscando animales…" compacto /> : animales.length === 0 ? <EstadoVacio titulo="No encontramos ese animal" descripcion="Revisa el arete o intenta con el nombre." compacto /> : animales.map((resultado) => (
                <button key={resultado.id} className="captura-animal-row" onClick={() => seleccionar(resultado)}>
                  <span><strong>{resultado.arete_id}</strong><small>{resultado.nombre_alias || 'Sin alias'} · {resultado.corral_actual || 'Sin corral'}</small></span><span>Elegir →</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="animal-context"><strong>{animal.arete_id}</strong><span>{animal.nombre_alias || 'Sin alias'} · {animal.corral_actual || 'Sin corral'}</span><button onClick={() => { setAnimal(null); setAccion(null); }}>Cambiar</button></div>
            <AccionesRapidasAnimal animal={animal} accionesPermitidas={sinConexion ? ACCIONES_OFFLINE : null} onAccion={setAccion} />
          </>
        )}
    </ModalAccesible>
  );
}
