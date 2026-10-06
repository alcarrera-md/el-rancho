-- Migración: agregar soporte de foto opcional al animal.
-- Ejecuta esto en tu base de datos EXISTENTE (no hace falta recrear nada).

ALTER TABLE animal ADD COLUMN IF NOT EXISTS foto_url VARCHAR(255);

-- Actualiza la vista para que también incluya la foto
CREATE OR REPLACE VIEW vista_ficha_animal AS
SELECT
    a.id,
    a.arete_id,
    a.nombre_alias,
    a.sexo,
    a.fecha_nacimiento,
    r.nombre AS raza,
    a.estado,
    c.nombre AS corral_actual,
    (SELECT peso_kg FROM pesaje p WHERE p.animal_id = a.id ORDER BY fecha DESC LIMIT 1) AS ultimo_peso_kg,
    (SELECT fecha FROM pesaje p WHERE p.animal_id = a.id ORDER BY fecha DESC LIMIT 1) AS fecha_ultimo_pesaje,
    (SELECT COUNT(*) FROM evento_salud s WHERE s.animal_id = a.id) AS total_eventos_salud,
    (SELECT COUNT(*) FROM evento_reproductivo er WHERE er.madre_id = a.id) AS total_eventos_reproductivos,
    a.foto_url
FROM animal a
LEFT JOIN raza r ON r.id = a.raza_id
LEFT JOIN corral c ON c.id = a.corral_actual_id;
