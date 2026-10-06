import { useNavigate } from 'react-router-dom';

export default function BotonVolver({ destino = '/', etiqueta = 'Volver' }) {
  const navigate = useNavigate();
  function volver() {
    if (window.history.length > 1) navigate(-1);
    else navigate(destino, { replace: true });
  }
  return <button type="button" className="back-button" onClick={volver} aria-label={`${etiqueta} a la pantalla anterior`}><span aria-hidden="true">←</span>{etiqueta}</button>;
}
