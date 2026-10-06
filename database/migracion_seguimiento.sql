-- Migración: modo de seguimiento por animal.
-- Ejecuta esto en tu base de datos EXISTENTE.

ALTER TABLE animal ADD COLUMN IF NOT EXISTS en_seguimiento BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE animal ADD COLUMN IF NOT EXISTS motivo_seguimiento TEXT;

CREATE INDEX IF NOT EXISTS idx_animal_seguimiento ON animal(en_seguimiento) WHERE en_seguimiento = true;

-- =========================================================
-- Producción de leche (registro de ordeño por animal)
-- =========================================================
CREATE TABLE IF NOT EXISTS produccion_leche (
    id              SERIAL PRIMARY KEY,
    animal_id       INT NOT NULL REFERENCES animal(id),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    turno           VARCHAR(10) NOT NULL DEFAULT 'unico' CHECK (turno IN ('manana','tarde','unico')),
    litros          DECIMAL(6,2) NOT NULL CHECK (litros >= 0),
    trabajador_id   INT REFERENCES trabajador(id),
    observacion     TEXT,
    UNIQUE (animal_id, fecha, turno)
);
CREATE INDEX IF NOT EXISTS idx_leche_animal_fecha ON produccion_leche(animal_id, fecha);

-- Reutiliza la misma regla de "no fechas futuras" ya definida para pesajes/salud/alimentación
DROP TRIGGER IF EXISTS trg_leche_fecha_no_futura ON produccion_leche;
CREATE TRIGGER trg_leche_fecha_no_futura
BEFORE INSERT OR UPDATE ON produccion_leche
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_no_futura();

-- Y la misma regla de "no antes del nacimiento"
DROP TRIGGER IF EXISTS trg_leche_fecha_valida ON produccion_leche;
CREATE TRIGGER trg_leche_fecha_valida
BEFORE INSERT OR UPDATE ON produccion_leche
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_posterior_nacimiento();

-- Actualiza la vista para incluir el estado de seguimiento (se agrega al final,
-- ya que PostgreSQL no permite reordenar columnas de una vista existente)
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
    a.foto_url,
    a.en_seguimiento,
    a.motivo_seguimiento
FROM animal a
LEFT JOIN raza r ON r.id = a.raza_id
LEFT JOIN corral c ON c.id = a.corral_actual_id;
