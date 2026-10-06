import { Link } from 'react-router-dom';

export default function AccesoRestringido() {
  return (
    <div className="card route-state" role="alert">
      <div className="route-state-code">403</div>
      <h1>Acceso restringido</h1>
      <p>Tu rol actual no permite abrir esta sección. Si tus responsabilidades cambiaron, vuelve a intentarlo después de que un administrador actualice tu acceso.</p>
      <Link className="btn btn-primary" to="/">Volver al inicio</Link>
    </div>
  );
}
