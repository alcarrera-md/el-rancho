import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { ACCIONES_CAMPO } from '../fieldActions.js';
import { ALMACEN_ANIMALES, ALMACEN_CORRALES, leerColeccionLocal, listarCambiosLocalesAnimal } from '../offline/campoDB.js';
import { suscribirColaOffline } from '../offline/colaOperaciones.js';
import { construirFichaOffline } from '../offline/fichaOffline.js';
import AccionesRapidasAnimal from './AccionesRapidasAnimal.jsx';
import FlujoAccionAnimal from './FlujoAccionAnimal.jsx';
import IndicadorDatosLocales from './IndicadorDatosLocales.jsx';
import ModuleHeader from './ModuleHeader.jsx';
import { EstadoCarga, EstadoError, FeedbackOperacion } from './EstadosUI.jsx';
import { IconoAnimal } from './Iconos.jsx';
import BotonVolver from './BotonVolver.jsx';

const ACCIONES = [ACCIONES_CAMPO.PESAJE, ACCIONES_CAMPO.SALUD, ACCIONES_CAMPO.CONDICION, ACCIONES_CAMPO.NOTA, ACCIONES_CAMPO.OBSERVACION, ACCIONES_CAMPO.ALIMENTACION, ACCIONES_CAMPO.MOVER];
const SALUD = { sano: 'Sano', observacion: 'En observación', enfermo: 'Enfermo' };

function Dato({ etiqueta, valor, detalle }) {
  return <div><span>{etiqueta}</span><strong>{valor ?? 'Sin dato'}</strong>{detalle && <small>{detalle}</small>}</div>;
}

export default function SeguimientoAnimalOffline({ animalId }) {
  const { usuario } = useAuth();
  const [estado, setEstado] = useState(null);
  const [flujo, setFlujo] = useState(null);
  const [confirmacion, setConfirmacion] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [animales, corrales, cambios] = await Promise.all([
        leerColeccionLocal(ALMACEN_ANIMALES, usuario?.id),
        leerColeccionLocal(ALMACEN_CORRALES, usuario?.id),
        listarCambiosLocalesAnimal(usuario?.id, Number(animalId)),
      ]);
      const animal = (animales?.datos || []).find((item) => String(item.id) === String(animalId)) || null;
      setEstado({
        animal,
        ficha: construirFichaOffline({ animal, corrales: corrales?.datos || [], cambios }),
        sincronizadoEn: animales?.sincronizado_en || null,
      });
    } catch {
      setEstado({ error: 'No se pudo leer el animal guardado en este dispositivo.' });
    }
  }, [animalId, usuario?.id]);

  useEffect(() => { void cargar(); }, [cargar]);
  // Una captura nueva o un envío confirmado actualiza la sección de pendientes.
  useEffect(() => (usuario?.id ? suscribirColaOffline(usuario.id, () => { void cargar(); }) : undefined), [cargar, usuario?.id]);

  if (!estado) return <EstadoCarga mensaje="Buscando animal en el dispositivo…" />;
  if (estado.error) return <EstadoError mensaje={estado.error} />;
  if (!estado.ficha) return <EstadoError mensaje="Este animal no está disponible en la última sincronización." />;
  const { animal, ficha } = estado;
  const sinDato = ficha.snapshot_completo ? null : 'Sin dato en esta copia; sincroniza para obtenerlo.';

  return (
    <div className="offline-animal-detail">
      <BotonVolver destino="/animales" etiqueta="Animales" />
      <ModuleHeader eyebrow="Ficha sin conexión" title={ficha.titulo} description="Información de la última sincronización. Puede no reflejar cambios recientes de otros usuarios." icon={IconoAnimal} accent="animal" />
      <IndicadorDatosLocales sincronizadoEn={estado.sincronizadoEn} />
      {ficha.vida.aviso && <p className="offline-animal-baja" role="note">{ficha.vida.aviso}</p>}

      <section className="card offline-animal-identity" aria-label="Identificación">
        <Dato etiqueta="Arete" valor={ficha.identidad.arete} />
        <Dato etiqueta="Estado" valor={ficha.vida.estado} detalle={ficha.vida.fecha_baja ? `Baja: ${ficha.vida.fecha_baja}` : null} />
        <Dato etiqueta="Sexo" valor={ficha.identidad.sexo} />
        <Dato etiqueta="Categoría" valor={ficha.identidad.categoria} />
        <Dato etiqueta="Raza" valor={ficha.identidad.raza} />
        <Dato etiqueta="Edad" valor={ficha.identidad.edad} detalle={ficha.identidad.nacimiento ? `Nació el ${ficha.identidad.nacimiento}` : null} />
        <Dato etiqueta="Corral" valor={ficha.corral?.nombre || 'Sin corral'} detalle={ficha.corral?.texto_capacidad} />
        <Dato
          etiqueta="Último peso (servidor)"
          valor={ficha.peso.servidor ? `${ficha.peso.servidor.kg} kg` : 'Sin pesaje'}
          detalle={ficha.peso.pendiente
            ? `${ficha.peso.pendiente.kg} kg · ${ficha.peso.pendiente.estado}`
            : ficha.peso.servidor?.fecha}
        />
        <Dato
          etiqueta="Condición corporal (servidor)"
          valor={ficha.condicion_corporal ? `${ficha.condicion_corporal.puntuacion} / 5` : (sinDato ? 'Sin dato' : 'Sin registro')}
          detalle={ficha.condicion_corporal_pendiente
            ? `${ficha.condicion_corporal_pendiente.puntuacion} / 5 · ${ficha.condicion_corporal_pendiente.estado}`
            : ficha.condicion_corporal?.fecha}
        />
        <Dato etiqueta="Salud" valor={SALUD[ficha.salud.estado] || ficha.salud.estado} detalle={[ficha.salud.desde && `Desde ${ficha.salud.desde}`, ficha.salud.diagnostico].filter(Boolean).join(' · ') || null} />
      </section>

      {(ficha.cambios_locales.length > 0 || ficha.conflictos > 0) && (
        <section className="card offline-animal-pendientes" aria-labelledby="ficha-pendientes">
          <h2 id="ficha-pendientes">Cambios de este dispositivo</h2>
          <p>Todavía no aparecen en los datos del servidor.</p>
          <ul>{ficha.cambios_locales.map((cambio) => <li key={cambio.id}><strong>{cambio.texto}</strong><span>{cambio.estado}</span></li>)}</ul>
          {ficha.conflictos > 0 && <p className="offline-animal-conflicto">{ficha.conflictos} cambio{ficha.conflictos === 1 ? '' : 's'} necesita{ficha.conflictos === 1 ? '' : 'n'} revisión. <Link to="/configuracion/sincronizacion">Revisar</Link></p>}
        </section>
      )}

      <section className="card offline-animal-historial" aria-labelledby="ficha-salud">
        <h2 id="ficha-salud">Salud reciente</h2>
        {sinDato ? <p>{sinDato}</p> : <>
          {ficha.salud.proximas_dosis.length > 0 && <ul>{ficha.salud.proximas_dosis.map((dosis, i) => <li key={`d-${i}`} className={dosis.vencida ? 'is-vencida' : ''}><strong>{dosis.vencida ? 'Dosis vencida' : 'Próxima dosis'}: {dosis.fecha}</strong><span>{[dosis.tipo, dosis.enfermedad].filter(Boolean).join(' · ')}</span></li>)}</ul>}
          {ficha.salud.eventos.length > 0
            ? <ul>{ficha.salud.eventos.map((evento, i) => <li key={`e-${i}`}><strong>{evento.fecha}</strong><span>{[evento.tipo, evento.enfermedad].filter(Boolean).join(' · ')}</span></li>)}</ul>
            : <p>Sin eventos sanitarios en los últimos 180 días.</p>}
        </>}
      </section>

      <section className="card offline-animal-historial" aria-labelledby="ficha-notas">
        <h2 id="ficha-notas">Notas recientes</h2>
        {sinDato ? <p>{sinDato}</p> : ficha.notas.length > 0
          ? <ul>{ficha.notas.map((nota, i) => <li key={`n-${i}`}><strong>{nota.fecha}{nota.autor ? ` · ${nota.autor}` : ''}</strong><span>{nota.tag ? `${nota.tag}: ` : ''}{nota.contenido}</span></li>)}</ul>
          : <p>Sin notas en los últimos 90 días.</p>}
      </section>

      <FeedbackOperacion mensaje={confirmacion} />
      {ficha.vida.activo && <section className="card offline-animal-actions"><h2>Registrar trabajo</h2><AccionesRapidasAnimal animal={animal} accionesPermitidas={ACCIONES} onAccion={setFlujo} /></section>}
      <section className="card offline-unavailable"><h2>Disponible al recuperar conexión</h2><p>Historial completo, reproducción, recomendaciones, rentabilidad, fotografías y edición del expediente.</p></section>
      {flujo && <FlujoAccionAnimal animal={animal} accion={flujo} onCerrar={() => setFlujo(null)} onCompletado={(mensaje) => { setFlujo(null); setConfirmacion(mensaje); void cargar(); }} />}
    </div>
  );
}
