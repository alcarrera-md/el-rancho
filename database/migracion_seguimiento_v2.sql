-- Migración: rediseño del modo de seguimiento.
-- Ejecuta esto en tu base de datos EXISTENTE.

-- =========================================================
-- 0) Primero hay que quitar la vista, porque depende de las
--    columnas que estamos a punto de eliminar (en_seguimiento,
--    motivo_seguimiento). La recreamos al final del script.
-- =========================================================
DROP VIEW IF EXISTS vista_ficha_animal;

-- =========================================================
-- 1) Estado de salud (la "banderita") — reemplaza al viejo
--    en_seguimiento/motivo_seguimiento (ya no hace falta "activar"
--    nada; el seguimiento está disponible siempre para animales vivos)
-- =========================================================
ALTER TABLE animal DROP COLUMN IF EXISTS en_seguimiento;
ALTER TABLE animal DROP COLUMN IF EXISTS motivo_seguimiento;

ALTER TABLE animal ADD COLUMN IF NOT EXISTS estado_salud VARCHAR(20) NOT NULL DEFAULT 'sano'
    CHECK (estado_salud IN ('sano', 'observacion', 'enfermo'));
ALTER TABLE animal ADD COLUMN IF NOT EXISTS salud_fecha_inicio DATE;
ALTER TABLE animal ADD COLUMN IF NOT EXISTS salud_diagnostico TEXT;
ALTER TABLE animal ADD COLUMN IF NOT EXISTS salud_tratamiento TEXT;

CREATE INDEX IF NOT EXISTS idx_animal_estado_salud ON animal(estado_salud);

-- =========================================================
-- 2) Categoría / etapa productiva
-- =========================================================
ALTER TABLE animal ADD COLUMN IF NOT EXISTS categoria VARCHAR(20) DEFAULT 'cria'
    CHECK (categoria IN ('cria', 'destete', 'engorde', 'vientre', 'reproductor', 'descarte'));

CREATE TABLE IF NOT EXISTS historial_categoria (
    id                  SERIAL PRIMARY KEY,
    animal_id           INT NOT NULL REFERENCES animal(id),
    categoria_anterior  VARCHAR(20),
    categoria_nueva     VARCHAR(20) NOT NULL,
    fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
    motivo              TEXT,
    trabajador_id       INT REFERENCES trabajador(id)
);
CREATE INDEX IF NOT EXISTS idx_historial_categoria_animal ON historial_categoria(animal_id);

-- =========================================================
-- 3) Condición corporal (escala estándar 1 a 5)
-- =========================================================
CREATE TABLE IF NOT EXISTS condicion_corporal (
    id              SERIAL PRIMARY KEY,
    animal_id       INT NOT NULL REFERENCES animal(id),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    puntuacion      SMALLINT NOT NULL CHECK (puntuacion BETWEEN 1 AND 5),
    observacion     TEXT,
    trabajador_id   INT REFERENCES trabajador(id)
);
CREATE INDEX IF NOT EXISTS idx_condicion_animal_fecha ON condicion_corporal(animal_id, fecha);

DROP TRIGGER IF EXISTS trg_condicion_fecha_no_futura ON condicion_corporal;
CREATE TRIGGER trg_condicion_fecha_no_futura
BEFORE INSERT OR UPDATE ON condicion_corporal
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_no_futura();

DROP TRIGGER IF EXISTS trg_condicion_fecha_valida ON condicion_corporal;
CREATE TRIGGER trg_condicion_fecha_valida
BEFORE INSERT OR UPDATE ON condicion_corporal
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_posterior_nacimiento();

-- =========================================================
-- 4) Bitácora de notas entre trabajadores (diario del animal)
-- =========================================================
CREATE TABLE IF NOT EXISTS nota_seguimiento (
    id          SERIAL PRIMARY KEY,
    animal_id   INT NOT NULL REFERENCES animal(id),
    usuario_id  INT REFERENCES usuario(id),
    tag         VARCHAR(30),
    contenido   TEXT NOT NULL,
    fecha       TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nota_animal ON nota_seguimiento(animal_id, fecha);

-- =========================================================
-- 5) Recrear la vista de ficha del animal con los campos nuevos
--    (se quitó al inicio del script porque dependía de las
--    columnas eliminadas en el paso 1)
-- =========================================================
CREATE VIEW vista_ficha_animal AS
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
    a.estado_salud,
    a.categoria
FROM animal a
LEFT JOIN raza r ON r.id = a.raza_id
LEFT JOIN corral c ON c.id = a.corral_actual_id;
