import { useEffect, useState } from 'react';
import { api } from '../api';

const ETIQUETA_NIVEL_ANCESTRO = { 1: 'Padres', 2: 'Abuelos', 3: 'Bisabuelos' };
const ETIQUETA_NIVEL_DESCENDIENTE = { 1: 'Hijos', 2: 'Nietos', 3: 'Bisnietos' };

function TarjetaAnimal({ animal, resaltado, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        padding: '8px 10px', borderRadius: 8, minWidth: 90, cursor: 'pointer',
        background: resaltado ? 'var(--wheat)' : '#fff',
        border: `1px solid ${resaltado ? 'var(--wheat)' : 'var(--line)'}`,
        color: resaltado ? 'var(--pasture-dark)' : 'var(--ink)',
      }}
    >
      <span style={{ fontSize: '1rem' }}>{animal.sexo === 'hembra' ? '♀' : '♂'}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 600 }}>{animal.arete_id}</span>
      {animal.nombre_alias && <span style={{ fontSize: '0.72rem', color: 'var(--ink-soft)' }}>{animal.nombre_alias}</span>}
    </button>
  );
}

export default function ArbolGenealogico({ animalId, onAbrirSeguimiento }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.obtenerGenealogia(animalId).then(setData).catch((err) => setError(err.message));
  }, [animalId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="empty-state">Cargando árbol...</div>;

  const { animal, ancestros, descendientes } = data;

  const ancestrosPorNivel = {};
  ancestros.forEach((a) => {
    if (!ancestrosPorNivel[a.nivel]) ancestrosPorNivel[a.nivel] = [];
    ancestrosPorNivel[a.nivel].push(a);
  });
  const descendientesPorNivel = {};
  descendientes.forEach((d) => {
    if (!descendientesPorNivel[d.nivel]) descendientesPorNivel[d.nivel] = [];
    descendientesPorNivel[d.nivel].push(d);
  });

  const nivelesAncestros = Object.keys(ancestrosPorNivel).map(Number).sort((a, b) => b - a); // bisabuelos primero
  const nivelesDescendientes = Object.keys(descendientesPorNivel).map(Number).sort((a, b) => a - b); // hijos primero

  if (ancestros.length === 0 && descendientes.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 24 }}>
        <h3 style={{ fontSize: '0.95rem' }}>Todavía no hay datos de padres ni crías para armar el árbol</h3>
        <p>Se completa solo conforme registres madre/padre al dar de alta animales, o partos.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center', overflowX: 'auto', padding: '4px 0' }}>
      {nivelesAncestros.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
          {nivelesAncestros.map((nivel) => (
            <div key={nivel} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', textTransform: 'uppercase', marginBottom: 6 }}>
                {ETIQUETA_NIVEL_ANCESTRO[nivel] || `Generación -${nivel}`}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {ancestrosPorNivel[nivel].map((a) => (
                  <TarjetaAnimal key={a.id} animal={a} onClick={() => onAbrirSeguimiento(a.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', textTransform: 'uppercase', marginBottom: 6 }}>Este animal</div>
        <TarjetaAnimal animal={animal} resaltado />
      </div>

      {nivelesDescendientes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
          {nivelesDescendientes.map((nivel) => (
            <div key={nivel} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', textTransform: 'uppercase', marginBottom: 6 }}>
                {ETIQUETA_NIVEL_DESCENDIENTE[nivel] || `Generación +${nivel}`}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {descendientesPorNivel[nivel].map((d) => (
                  <TarjetaAnimal key={d.id} animal={d} onClick={() => onAbrirSeguimiento(d.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
