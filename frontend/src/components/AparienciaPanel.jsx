import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  aplicarPreferenciasApariencia, obtenerPreferenciasApariencia,
} from '../theme.js';

const OPCIONES = {
  tema: [['claro', 'Claro'], ['oscuro', 'Oscuro'], ['automatico', 'Automático']],
  paleta: [['rancho', 'Rancho clásico'], ['tierra', 'Tierra'], ['bosque', 'Bosque'], ['noche', 'Noche'], ['azul', 'Azul técnico']],
  texto: [['normal', 'Normal'], ['grande', 'Grande'], ['muy-grande', 'Muy grande']],
  densidad: [['comoda', 'Cómoda'], ['compacta', 'Compacta']],
  contraste: [['normal', 'Normal'], ['alto', 'Alto']],
  esquinas: [['rectas', 'Rectas'], ['suaves', 'Suaves'], ['redondas', 'Redondas']],
};

function Selector({ titulo, descripcion, nombre, valor, opciones, onChange }) {
  return (
    <fieldset className="appearance-group">
      <legend>{titulo}</legend>
      <p>{descripcion}</p>
      <div className={`appearance-options appearance-options-${nombre}`}>
        {opciones.map(([id, etiqueta]) => (
          <label key={id} className={valor === id ? 'selected' : ''}>
            <input type="radio" name={nombre} value={id} checked={valor === id} onChange={() => onChange(id)} />
            {nombre === 'paleta' && <span className={`palette-swatch palette-${id}`} aria-hidden="true" />}
            <span>{etiqueta}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function AparienciaPanel() {
  const { usuario } = useAuth();
  const [preferencias, setPreferencias] = useState(() => obtenerPreferenciasApariencia(usuario?.id));

  function cambiar(clave, valor) {
    const nuevas = { ...preferencias, [clave]: valor };
    setPreferencias(aplicarPreferenciasApariencia(nuevas, usuario?.id, { elegidas: true }));
  }

  return (
    <div className="appearance-layout">
      <div className="settings-section-heading">
        <span>Apariencia</span>
        <h1>Haz que El Rancho se sienta tuyo</h1>
        <p>Estos ajustes se guardan localmente para tu cuenta y no contienen datos operativos.</p>
      </div>

      <div className="appearance-content">
        <div className="appearance-controls">
          <Selector titulo="Tema" descripcion="Usa un fondo claro, oscuro o sigue la preferencia del dispositivo." nombre="tema" valor={preferencias.tema} opciones={OPCIONES.tema} onChange={(v) => cambiar('tema', v)} />
          <Selector titulo="Paleta de color" descripcion="Cambia los acentos y la personalidad visual sin alterar la información." nombre="paleta" valor={preferencias.paleta} opciones={OPCIONES.paleta} onChange={(v) => cambiar('paleta', v)} />
          <Selector titulo="Tamaño de texto" descripcion="Aumenta la lectura en jornadas de campo o pantallas pequeñas." nombre="texto" valor={preferencias.texto} opciones={OPCIONES.texto} onChange={(v) => cambiar('texto', v)} />
          <Selector titulo="Densidad visual" descripcion="Elige más aire o más información visible en cada pantalla." nombre="densidad" valor={preferencias.densidad} opciones={OPCIONES.densidad} onChange={(v) => cambiar('densidad', v)} />
          <Selector titulo="Contraste" descripcion="Refuerza bordes y separación entre superficies." nombre="contraste" valor={preferencias.contraste} opciones={OPCIONES.contraste} onChange={(v) => cambiar('contraste', v)} />
          <Selector titulo="Esquinas" descripcion="Ajusta el carácter de tarjetas, campos y botones." nombre="esquinas" valor={preferencias.esquinas} opciones={OPCIONES.esquinas} onChange={(v) => cambiar('esquinas', v)} />
        </div>

        <aside className="appearance-preview" aria-label="Vista previa de apariencia">
          <div className="appearance-preview-top"><span className="guided-eyebrow">Vista previa</span><span>En vivo</span></div>
          <div className="appearance-preview-card">
            <div className="appearance-preview-icon">ER</div>
            <div><strong>Corral Norte</strong><small>12 animales · Estado estable</small></div>
            <span className="pill pill-sano">Activo</span>
          </div>
          <div className="appearance-preview-metrics" aria-hidden="true">
            <span><i />12<small>Animales</small></span>
            <span><i />2<small>Pendientes</small></span>
            <span><i />0<small>Alertas</small></span>
          </div>
          <button type="button" className="btn btn-primary">Acción principal</button>
          <button type="button" className="btn btn-ghost">Acción secundaria</button>
        </aside>
      </div>
    </div>
  );
}
