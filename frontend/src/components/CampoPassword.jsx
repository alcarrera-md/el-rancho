import { useId, useState } from 'react';

export default function CampoPassword({ label = 'Contraseña', value, onChange, autoFocus = false, required = false, id: idProp, ayuda = null, autoComplete = 'new-password', minLength, maxLength }) {
  const idInterno = useId();
  const id = idProp || idInterno;
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required ? ' *' : ''}</label>
      <div className="password-field">
        <input id={id} className="input" type={visible ? 'text' : 'password'} autoFocus={autoFocus} required={required} value={value} onChange={onChange} autoComplete={autoComplete} minLength={minLength} maxLength={maxLength} />
        <button type="button" className="btn btn-ghost password-toggle" onClick={() => setVisible((actual) => !actual)} aria-pressed={visible} aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`}>
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {ayuda && <small className="field-help">{ayuda}</small>}
    </div>
  );
}
