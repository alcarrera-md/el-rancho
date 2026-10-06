-- Migración: umbrales para la detección de clústeres de contacto (posibles brotes)
-- y su análisis con IA. Ejecuta esto en tu base de datos EXISTENTE.

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('dias_ventana_brote_ia', 45, 'Días hacia atrás que se revisan para reconstruir qué animales compartieron corral (ventana de contacto para detectar posibles brotes)'),
    ('min_afectados_cluster_brote', 2, 'Mínimo de animales enfermos/en observación dentro de un mismo clúster de contacto para considerarlo un posible brote')
ON CONFLICT (clave) DO NOTHING;
