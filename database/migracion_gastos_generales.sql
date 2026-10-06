-- Migración: gastos generales del rancho.
-- Ejecuta esto en tu base de datos EXISTENTE.

-- Catálogo de categorías de gasto (el rancho define las suyas propias)
CREATE TABLE IF NOT EXISTS categoria_gasto (
    id      SERIAL PRIMARY KEY,
    nombre  VARCHAR(80) UNIQUE NOT NULL
);

INSERT INTO categoria_gasto (nombre) VALUES
    ('Veterinario'), ('Electricidad'), ('Combustible'), ('Mano de obra'),
    ('Mantenimiento'), ('Renta de terreno'), ('Impuestos'), ('Otro')
ON CONFLICT (nombre) DO NOTHING;

-- Gastos generales (no ligados a un animal en particular)
CREATE TABLE IF NOT EXISTS gasto_general (
    id              SERIAL PRIMARY KEY,
    categoria_id    INT NOT NULL REFERENCES categoria_gasto(id),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    monto           DECIMAL(12,2) NOT NULL CHECK (monto >= 0),
    descripcion     TEXT,
    corral_id       INT REFERENCES corral(id),   -- opcional: si el gasto es de un corral específico
    comprobante_folio VARCHAR(100),
    usuario_id      INT REFERENCES usuario(id)
);
CREATE INDEX IF NOT EXISTS idx_gasto_fecha ON gasto_general(fecha);
CREATE INDEX IF NOT EXISTS idx_gasto_categoria ON gasto_general(categoria_id);

-- No se permiten fechas futuras (misma regla que ya usamos en el resto del sistema)
DROP TRIGGER IF EXISTS trg_gasto_fecha_no_futura ON gasto_general;
CREATE TRIGGER trg_gasto_fecha_no_futura
BEFORE INSERT OR UPDATE ON gasto_general
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_no_futura();
