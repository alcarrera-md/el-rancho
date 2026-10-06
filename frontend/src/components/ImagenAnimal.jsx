import { useEffect, useState } from 'react';
import { urlFoto } from '../api';

export default function ImagenAnimal({ fotoUrl, alt = '', className, fallback }) {
  const [fallo, setFallo] = useState(false);
  const fuente = urlFoto(fotoUrl);

  useEffect(() => setFallo(false), [fuente]);

  if (!fuente || fallo) return fallback;
  return <img src={fuente} alt={alt} className={className} onError={() => setFallo(true)} />;
}
