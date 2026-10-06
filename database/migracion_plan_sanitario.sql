-- Migración: plantillas de plan sanitario.
-- Ejecuta esto en tu base de datos EXISTENTE.

-- =========================================================
-- 1) Plantillas de plan sanitario (ej. "Protocolo de becerros")
-- =========================================================
CREATE TABLE IF NOT EXISTS plan_sanitario (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(150) NOT NULL,
    descripcion TEXT,
    activo      BOOLEAN NOT NULL DEFAULT true
);

-- =========================================================
-- 2) Eventos de cada plantilla (ej. "Vacuna Triple a los 90 días")
--    edad_dias = a cuántos días de nacido le toca este evento
-- =========================================================
CREATE TABLE IF NOT EXISTS plan_sanitario_item (
    id              SERIAL PRIMARY KEY,
    plan_id         INT NOT NULL REFERENCES plan_sanitario(id) ON DELETE CASCADE,
    nombre_evento   VARCHAR(150) NOT NULL,
    tipo            VARCHAR(20) NOT NULL DEFAULT 'vacuna' CHECK (tipo IN ('vacuna','tratamiento','desparasitacion')),
    insumo_id       INT REFERENCES insumo(id),
    edad_dias       INT NOT NULL CHECK (edad_dias >= 0),
    descripcion     TEXT
);
CREATE INDEX IF NOT EXISTS idx_plan_item_plan ON plan_sanitario_item(plan_id);

-- =========================================================
-- 3) Qué animal tiene asignado qué plan
-- =========================================================
CREATE TABLE IF NOT EXISTS animal_plan_sanitario (
    id                  SERIAL PRIMARY KEY,
    animal_id           INT NOT NULL REFERENCES animal(id),
    plan_id             INT NOT NULL REFERENCES plan_sanitario(id) ON DELETE CASCADE,
    fecha_asignacion    DATE NOT NULL DEFAULT CURRENT_DATE,
    UNIQUE (animal_id, plan_id)
);
CREATE INDEX IF NOT EXISTS idx_animal_plan_animal ON animal_plan_sanitario(animal_id);

-- =========================================================
-- 4) Enlazar un evento de salud con el ítem del plan que cumple
--    (así el sistema sabe que ya se aplicó y deja de marcarlo pendiente)
-- =========================================================
ALTER TABLE evento_salud ADD COLUMN IF NOT EXISTS plan_item_id INT REFERENCES plan_sanitario_item(id);
