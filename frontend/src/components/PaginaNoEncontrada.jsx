import { Link } from 'react-router-dom';

export default function PaginaNoEncontrada({ animal = false }) {
  return (
    <div className="card route-state" role="alert">
      <div className="route-state-code">404</div>
      <h1>{animal ? 'Animal no encontrado' : 'Página no encontrada'}</h1>
      <p>{animal ? 'El animal no existe o ya no está disponible.' : 'El enlace no corresponde a una sección disponible del sistema.'}</p>
      <Link className="btn btn-primary" to={animal ? '/animales' : '/'}>{animal ? 'Ver animales' : 'Volver al inicio'}</Link>
    </div>
  );
}
