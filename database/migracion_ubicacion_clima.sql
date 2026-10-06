-- Migración: ubicación del rancho (para el clima).
-- Ejecuta esto en tu base de datos EXISTENTE.
-- El valor de ejemplo es Ciudad de México — CÁMBIALO por la ubicación real
-- de tu rancho después de correr esto (desde "Configuración" en el sistema,
-- o editando aquí mismo antes de ejecutar).
--
-- Cómo obtener tus coordenadas: abre Google Maps, ubica tu rancho, haz clic
-- derecho sobre el punto exacto y copia los dos números que aparecen
-- (el primero es la latitud, el segundo la longitud).

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('ubicacion_lat', 19.4326, 'Latitud del rancho (para consultar el clima) — obténla con clic derecho en Google Maps'),
    ('ubicacion_lon', -99.1332, 'Longitud del rancho (para consultar el clima) — obténla con clic derecho en Google Maps')
ON CONFLICT (clave) DO NOTHING;
