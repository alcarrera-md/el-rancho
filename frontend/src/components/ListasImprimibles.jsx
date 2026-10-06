import { useEffect, useState } from 'react';
import { api } from '../api';
import { exportarListaAnimalesPDF, exportarListaTareasPDF, exportarListaVacunasPDF, exportarEtiquetasQR } from '../exportUtils.js';
import ModuleHeader from './ModuleHeader.jsx';
import { IconoAnimal, IconoLista, IconoQR, IconoReportes, IconoSalud } from './Iconos.jsx';

function FormatoCard({ icono: Icono, titulo, genera, utilidad, momento, accion, cargando, tono }) {
  return (
    <article className={`print-format-card tone-${tono}`}>
      <span className="print-format-icon" aria-hidden="true"><Icono /></span>
      <div className="print-format-copy"><h3>{titulo}</h3><p>{genera}</p></div>
      <dl><div><dt>Para qué sirve</dt><dd>{utilidad}</dd></div><div><dt>Cuándo usarlo</dt><dd>{momento}</dd></div></dl>
      <button className="btn btn-primary" onClick={accion} disabled={cargando}>{cargando ? 'Preparando formato…' : 'Generar PDF'}</button>
    </article>
  );
}

export default function ListasImprimibles() {
  const [corrales, setCorrales] = useState([]);
  const [corralId, setCorralId] = useState('');
  const [error, setError] = useState(null);
  const [generando, setGenerando] = useState(null);

  useEffect(() => {
    api.listarCorrales().then(setCorrales).catch(() => {});
  }, []);

  async function imprimirAnimales() {
    setGenerando('animales');
    setError(null);
    try {
      const params = { estado: 'vivo' };
      if (corralId) params.corral_id = corralId;
      const animales = await api.listarAnimales(params);
      if (animales.length === 0) {
        setError('No hay animales vivos en esta selección.');
        return;
      }
      const nombreCorral = corralId ? corrales.find((c) => String(c.id) === String(corralId))?.nombre : null;
      await exportarListaAnimalesPDF(animales, nombreCorral);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerando(null);
    }
  }

  async function imprimirTareas() {
    setGenerando('tareas');
    setError(null);
    try {
      const tareas = await api.listarTareas({ completada: 'false' });
      if (tareas.length === 0) {
        setError('No hay tareas pendientes por ahora.');
        return;
      }
      await exportarListaTareasPDF(tareas);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerando(null);
    }
  }

  async function imprimirVacunas() {
    setGenerando('vacunas');
    setError(null);
    try {
      const vacunas = await api.proximasVacunas(30);
      if (vacunas.length === 0) {
        setError('No hay vacunas próximas en los siguientes 30 días.');
        return;
      }
      await exportarListaVacunasPDF(vacunas);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerando(null);
    }
  }

  async function imprimirQR() {
    setGenerando('qr');
    setError(null);
    try {
      const params = { estado: 'vivo' };
      if (corralId) params.corral_id = corralId;
      const animales = await api.listarAnimales(params);
      if (animales.length === 0) {
        setError('No hay animales vivos en esta selección.');
        return;
      }
      await exportarEtiquetasQR(animales);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerando(null);
    }
  }

  return (
    <div className="print-hub">
      <ModuleHeader eyebrow="Apoyo para campo" title="Formatos para operar y compartir" description="Genera documentos listos para llevar al corral, revisar en una junta o conservar como apoyo físico." icon={IconoReportes} accent="tecnico" />

      {error && <div className="error-banner">{error}</div>}

      <section className="print-scope" aria-labelledby="print-scope-title"><div><span>Antes de generar</span><h2 id="print-scope-title">Elige el alcance de los animales</h2><p>Este filtro se usa en la lista de animales y en las etiquetas.</p></div><label><span>Corral</span><select value={corralId} onChange={(e) => setCorralId(e.target.value)}><option value="">Todos los animales vivos</option>{corrales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label></section>

      <section className="print-category" aria-labelledby="print-daily"><div className="print-category-heading"><span>Operación diaria</span><div><h2 id="print-daily">Formatos para organizar el trabajo</h2><p>Útiles durante recorridos, pesajes y supervisión de pendientes.</p></div></div><div className="print-format-grid">
        <FormatoCard icono={IconoAnimal} tono="animals" titulo="Lista de animales" genera="Arete, alias, corral y espacios para anotar peso u observaciones." utilidad="Llevar control directo en campo sin depender del teléfono." momento="Durante pesajes, conteos o recorridos por corral." accion={imprimirAnimales} cargando={generando === 'animales'} />
        <FormatoCard icono={IconoLista} tono="tasks" titulo="Tareas pendientes" genera="Trabajo activo del equipo con casillas para marcar avances." utilidad="Coordinar la jornada y entregar una lista clara al responsable." momento="Al iniciar turno, repartir trabajo o supervisar avances." accion={imprimirTareas} cargando={generando === 'tareas'} />
      </div></section>

      <section className="print-category" aria-labelledby="print-health"><div className="print-category-heading"><span>Sanidad y seguimiento</span><div><h2 id="print-health">Formatos para revisión sanitaria</h2><p>Concentran lo que debe verificarse y documentarse durante la atención.</p></div></div><div className="print-format-grid single">
        <FormatoCard icono={IconoSalud} tono="health" titulo="Vacunas próximas" genera="Dosis programadas para los siguientes 30 días y casillas de aplicación." utilidad="Preparar la revisión sanitaria y evitar omitir animales." momento="Antes de una jornada de vacunación o visita veterinaria." accion={imprimirVacunas} cargando={generando === 'vacunas'} />
      </div></section>

      <section className="print-category" aria-labelledby="print-support"><div className="print-category-heading"><span>Apoyo para campo e identificación</span><div><h2 id="print-support">Material para consultar y compartir</h2><p>Formatos físicos que conectan el trabajo en campo con el expediente digital.</p></div></div><div className="print-format-grid single">
        <FormatoCard icono={IconoQR} tono="tracking" titulo="Etiquetas de identificación" genera="Una etiqueta QR por animal, lista para recortar y colocar." utilidad="Abrir rápidamente el seguimiento del animal desde el celular." momento="Al identificar corrales, expedientes físicos o puntos de revisión." accion={imprimirQR} cargando={generando === 'qr'} />
      </div></section>
    </div>
  );
}
