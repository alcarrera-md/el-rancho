import { useEffect, useState } from 'react';
import { api } from '../api';
import { mensajeErrorClima } from '../climaUx.js';
import { IconoGota, IconoSol, IconoViento } from './Iconos.jsx';
import IconoClima from './IconoClima.jsx';

const COLOR_TIPO = { lluvia: 'var(--azul-leche)', calor: 'var(--rust)', frio: 'var(--azul-leche)', viento: 'var(--ink-soft)' };

export default function ClimaPanel({ compacto = false }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [diaActivo, setDiaActivo] = useState(0);

  useEffect(() => {
    api.obtenerClima().then(setDatos).catch((err) => setError(mensajeErrorClima(err)));
  }, []);

  if (error) {
    return (
      <div className="card" style={{ padding: '16px 20px', marginBottom: 24, fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
        {error}
      </div>
    );
  }
  if (!datos) return null;

  const recomendacionesDelDia = datos.recomendaciones.filter((r) => r.dia === datos.dias[diaActivo]?.etiqueta);
  const dia = datos.dias[diaActivo];

  if (compacto) return (
    <div className="weather-compact">
      <div className="weather-compact-head"><span>Clima del rancho</span><strong>{dia?.etiqueta}</strong></div>
      <div className="weather-compact-main"><IconoClima descripcion={dia?.descripcion} tamano={42} /><div><strong>{dia?.temp_max}°</strong><span>{dia?.descripcion}</span></div></div>
      {dia?.prob_lluvia !== undefined && <div className="weather-compact-rain"><IconoGota /> <span>{dia.prob_lluvia}% de lluvia</span></div>}
      <p>{recomendacionesDelDia[0]?.mensaje || 'Condiciones normales para el trabajo del día.'}</p>
    </div>
  );

  return (
    <div className="card" style={{ padding: '20px 24px', marginBottom: 24, overflow: 'hidden' }}>
      <div className="section-title">Clima del rancho</div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {datos.dias.map((d, i) => (
          <div
            key={d.fecha}
            className={`clima-tarjeta ${i === 0 ? 'clima-hoy' : ''}`}
            onClick={() => setDiaActivo(i)}
            style={{
              flex: '1 1 130px', textAlign: 'center', padding: '14px 8px', borderRadius: 10,
              background: i === 0 ? undefined : 'var(--paper)',
              outline: diaActivo === i ? `2px solid var(--pasture)` : 'none',
              outlineOffset: -2,
            }}
          >
            <div className="clima-subtexto" style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginBottom: 6, fontWeight: i === 0 ? 700 : 500 }}>{d.etiqueta}</div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <IconoClima descripcion={d.descripcion} tamano={i === 0 ? 46 : 36} />
            </div>
            <div style={{ fontSize: '0.78rem', margin: '4px 0' }}>{d.descripcion}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700 }}>{d.temp_max}° <span style={{ opacity: 0.6, fontWeight: 400 }}>/ {d.temp_min}°</span></div>
            <div className="clima-subtexto" style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 8, fontSize: '0.72rem', color: 'var(--ink-soft)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><IconoGota width={12} height={12} />{d.prob_lluvia}%</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><IconoViento width={12} height={12} />{d.viento_max} km/h</span>
            </div>
          </div>
        ))}
      </div>

      {recomendacionesDelDia.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          {recomendacionesDelDia.map((r, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
              borderRadius: 8, background: 'var(--paper)', borderLeft: `3px solid ${COLOR_TIPO[r.tipo] || 'var(--wheat)'}`,
            }}>
              <span style={{ color: COLOR_TIPO[r.tipo] || 'var(--wheat)', flexShrink: 0, marginTop: 1 }}>
                {r.tipo === 'lluvia' && <IconoGota width={16} height={16} />}
                {r.tipo === 'calor' && <IconoSol width={16} height={16} />}
                {r.tipo === 'frio' && <IconoGota width={16} height={16} />}
                {r.tipo === 'viento' && <IconoViento width={16} height={16} />}
              </span>
              <span style={{ fontSize: '0.88rem' }}>{r.mensaje}</span>
            </div>
          ))}
        </div>
      )}
      {recomendacionesDelDia.length === 0 && (
        <p style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', margin: '0 0 10px' }}>Nada fuera de lo normal para {datos.dias[diaActivo]?.etiqueta.toLowerCase()}.</p>
      )}
      <div style={{ fontSize: '0.68rem', color: 'var(--ink-soft)', textAlign: 'right' }}>Datos del clima: OpenWeatherMap</div>
    </div>
  );
}
