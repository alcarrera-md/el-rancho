import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import EstadoSaludBadge from './EstadoSaludBadge.jsx';
import { IconoAnimal } from './Iconos.jsx';
import ImportarAnimalesModal from './ImportarAnimalesModal.jsx';
import AccionesRapidasAnimal from './AccionesRapidasAnimal.jsx';
import FlujoAccionAnimal from './FlujoAccionAnimal.jsx';
import { ACCIONES_CAMPO } from '../fieldActions.js';
import { EstadoCarga, EstadoError, EstadoVacio, FeedbackOperacion } from './EstadosUI.jsx';
import ImagenAnimal from './ImagenAnimal.jsx';
import ContextoNavegacion from './ContextoNavegacion.jsx';
import ModuleHeader from './ModuleHeader.jsx';
import { actualizarContexto, leerIdContexto } from '../navigationContext.js';
import IndicadorDatosLocales from './IndicadorDatosLocales.jsx';
import { buscarAnimalesOffline } from '../offline/fichaOffline.js';
import { CONECTIVIDAD_OFFLINE, esFalloDeConectividad, obtenerEstadoConectividad } from '../offline/connectivity.js';
import { ALMACEN_ANIMALES, ALMACEN_CORRALES, animalIdDeOperacion, leerColeccionLocal, listarOperacionesLocal } from '../offline/campoDB.js';

const ESTADO_LABEL = { vivo: 'Vivo', vendido: 'Vendido', sacrificado: 'Sacrificado', muerto: 'Muerto' };
const ACCIONES_OFFLINE = [ACCIONES_CAMPO.ABRIR, ACCIONES_CAMPO.PESAJE, ACCIONES_CAMPO.ALIMENTACION, ACCIONES_CAMPO.OBSERVACION, ACCIONES_CAMPO.SALUD, ACCIONES_CAMPO.CONDICION, ACCIONES_CAMPO.NOTA, ACCIONES_CAMPO.MOVER];

function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return '—';
  const nacimiento = new Date(fechaNacimiento);
  const hoy = new Date();
  let meses = (hoy.getFullYear() - nacimiento.getFullYear()) * 12 + (hoy.getMonth() - nacimiento.getMonth());
  if (hoy.getDate() < nacimiento.getDate()) meses--;
  if (meses < 1) return 'Recién nacido';
  if (meses < 24) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const anios = Math.floor(meses / 12);
  return `${anios} ${anios === 1 ? 'año' : 'años'}`;
}

const filtrarAnimalesLocal = (animales, { q, estado, corralAplicadoId }) => buscarAnimalesOffline(animales, { q, estado, corralId: corralAplicadoId });

export default function AnimalesList({ onNuevo, onAbrirSeguimiento, modoSeguimiento = false }) {
  const { usuario, estadoAutenticacion } = useAuth();
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || obtenerEstadoConectividad() === CONECTIVIDAD_OFFLINE;
  const [parametros, setParametros] = useSearchParams();
  const corralContextoId = leerIdContexto(parametros, 'corral');
  const puedeCrear = tienePermiso(usuario?.rol, 'animales', 'crear');
  const [animales, setAnimales] = useState([]);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [fuenteLocal, setFuenteLocal] = useState(false);
  const [sincronizadoEn, setSincronizadoEn] = useState(null);
  const [conCambiosLocales, setConCambiosLocales] = useState(() => new Set());
  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [flujo, setFlujo] = useState(null);
  const [confirmacion, setConfirmacion] = useState('');
  const [corrales, setCorrales] = useState(corralContextoId ? null : []);
  const corralContexto = (corrales || []).find((corral) => String(corral.id) === corralContextoId) || null;
  const corralAplicadoId = corrales === null ? corralContextoId : corralContexto?.id;

  function ejecutarAccion(animal, accion) {
    if (accion === ACCIONES_CAMPO.ABRIR) onAbrirSeguimiento(animal.id);
    else setFlujo({ animal, accion });
  }

  // Solo marca qué animales tienen capturas sin confirmar; el dato de la
  // tarjeta sigue siendo el del snapshot del servidor.
  async function cargarCambiosLocales() {
    const operaciones = await listarOperacionesLocal(usuario.id, ['pendiente', 'sincronizando', 'bloqueada', 'error']).catch(() => []);
    setConCambiosLocales(new Set(operaciones.map(animalIdDeOperacion).filter((id) => id !== null)));
  }

  async function cargar() {
    setCargando(true);
    setError(null);
    if (sinConexion && usuario?.id) {
      const local = await leerColeccionLocal(ALMACEN_ANIMALES, usuario.id).catch(() => null);
      await cargarCambiosLocales();
      if (local) {
        setAnimales(filtrarAnimalesLocal(local.datos, { q, estado, corralAplicadoId }));
        setSincronizadoEn(local.sincronizado_en);
        setFuenteLocal(true);
        setCargando(false);
        return;
      }
      setAnimales([]);
      setFuenteLocal(true);
      setError('No hay una copia local de Animales. Conéctate a Internet para sincronizarla.');
      setCargando(false);
      return;
    }
    try {
      const params = {};
      if (q) params.q = q;
      if (estado) params.estado = estado;
      if (corralAplicadoId) params.corral_id = corralAplicadoId;
      const data = await api.listarAnimales(params);
      setAnimales(data);
      setFuenteLocal(false);
    } catch (err) {
      // §8: sin conexión real, cae a la última copia sincronizada en
      // este dispositivo en vez de mostrar el error de red crudo.
      if (esFalloDeConectividad(err) && usuario?.id) {
        await cargarCambiosLocales();
        const local = await leerColeccionLocal(ALMACEN_ANIMALES, usuario.id).catch(() => null);
        if (local) {
          setAnimales(filtrarAnimalesLocal(local.datos, { q, estado, corralAplicadoId }));
          setSincronizadoEn(local.sincronizado_en);
          setFuenteLocal(true);
          return;
        }
      }
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(cargar, 250); // pequeño debounce al escribir
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, estado, corralAplicadoId, sinConexion, usuario?.id]);

  useEffect(() => {
    if (!corralContextoId) { setCorrales([]); return; }
    setCorrales(null);
    if (sinConexion && usuario?.id) {
      leerColeccionLocal(ALMACEN_CORRALES, usuario.id).then((local) => setCorrales(local?.datos || [])).catch(() => setCorrales([]));
    } else {
      api.listarCorrales().then(setCorrales).catch(() => setCorrales([]));
    }
  }, [corralContextoId, sinConexion, usuario?.id]);

  function quitarContexto() {
    setParametros(actualizarContexto(parametros, { corral: null }), { replace: true });
  }

  return (
    <div>
      <ModuleHeader className="animals-module-header" eyebrow={modoSeguimiento ? 'Modo offline limitado' : 'Inventario'} title={modoSeguimiento ? 'Selecciona un animal' : 'Tu ganado'} description={modoSeguimiento ? 'Abre la ficha básica y registra trabajo con los datos sincronizados.' : 'Consulta el hato y abre el expediente de cada animal.'} icon={IconoAnimal} accent="animal" action={puedeCrear && !modoSeguimiento ? (
          <div className="animals-header-actions">
            <button className="btn btn-primary" onClick={onNuevo} disabled={sinConexion} title={sinConexion ? 'Conéctate para registrar animales.' : undefined}>+ Registrar animal</button>
            <button className="btn btn-ghost" onClick={() => setMostrarImportar(true)} disabled={sinConexion} title={sinConexion ? 'Conéctate para importar animales.' : undefined}>Importar Excel</button>
          </div>
        ) : null} />

      <div className="toolbar">
        <input
          className="input"
          type="search"
          inputMode="search"
          autoComplete="off"
          aria-label="Buscar animal por arete o nombre"
          placeholder="Buscar por arete o nombre..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="vivo">Vivo</option>
          <option value="vendido">Vendido</option>
          <option value="sacrificado">Sacrificado</option>
          <option value="muerto">Muerto</option>
        </select>
      </div>

      <FeedbackOperacion mensaje={confirmacion} />
      {fuenteLocal && <IndicadorDatosLocales sincronizadoEn={sincronizadoEn} />}
      {error && <EstadoError mensaje={error} onReintentar={cargar} />}
      {corralContextoId && corrales && <ContextoNavegacion etiqueta={corralContexto?.nombre || `Corral ${corralContextoId}`} descripcion={corralContexto ? 'La lista muestra únicamente animales asignados actualmente a este corral.' : 'El corral solicitado ya no está disponible; se muestran todos los animales.'} invalido={!corralContexto} onLimpiar={quitarContexto} />}

      {cargando ? (
        <div className="card"><EstadoCarga mensaje="Cargando animales…" /></div>
      ) : animales.length === 0 ? (
        <div className="card"><EstadoVacio
          titulo={q || estado ? 'No hay animales que coincidan con la búsqueda' : 'Todavía no hay animales registrados'}
          descripcion={q || estado ? 'Prueba con otro arete, nombre o estado.' : 'Registra el primer animal para comenzar su seguimiento.'}
          accion={puedeCrear && !q && !estado ? <button className="btn btn-primary" onClick={onNuevo} disabled={sinConexion}>Registrar animal</button> : null}
        /></div>
      ) : (
        <div className="animal-grid">
          {animales.map((a) => (
            <div key={a.id} className="animal-card" onClick={() => onAbrirSeguimiento(a.id)}>
              <div className="animal-card-foto">
                <ImagenAnimal fotoUrl={a.foto_url} fallback={<IconoAnimal width={34} height={34} aria-hidden="true" />} />
                <span className={`pill pill-${a.estado} animal-card-estado`}>{ESTADO_LABEL[a.estado]}</span>
              </div>
              <div className="animal-card-body">
                <div className="animal-card-titulo">
                  <span>{a.nombre_alias || `Animal ${a.arete_id}`}</span>
                  <EstadoSaludBadge estado={a.estado} estadoSalud={a.estado_salud} tamano="chico" />
                </div>
                <span className="tag-badge">{a.arete_id}</span>
                {fuenteLocal && conCambiosLocales.has(Number(a.id)) && <span className="animal-card-pendiente">Cambio pendiente de sincronizar</span>}
                <div className="animal-card-meta">
                  <span>{a.sexo === 'hembra' ? 'Hembra' : 'Macho'}</span>
                  <span>{a.raza || 'Raza s/e'}</span>
                  <span>{calcularEdad(a.fecha_nacimiento)}</span>
                  <span>{a.ultimo_peso_kg ? `${a.ultimo_peso_kg} kg` : 'Sin peso'}</span>
                  <span>{a.corral_actual || 'Sin lote'}</span>
                </div>
                <AccionesRapidasAnimal animal={a} compacto incluirAbrir accionesPermitidas={sinConexion ? ACCIONES_OFFLINE : null} onAccion={(accion) => ejecutarAccion(a, accion)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {mostrarImportar && !sinConexion && (
        <ImportarAnimalesModal
          onCerrar={() => setMostrarImportar(false)}
          onListo={() => { setMostrarImportar(false); cargar(); }}
        />
      )}
      {flujo && (!sinConexion || ACCIONES_OFFLINE.includes(flujo.accion)) && (
        <FlujoAccionAnimal
          animal={flujo.animal}
          accion={flujo.accion}
          onCerrar={() => setFlujo(null)}
          onCompletado={(mensaje) => {
            setFlujo(null);
            setConfirmacion(mensaje);
            cargar();
          }}
        />
      )}
    </div>
  );
}
