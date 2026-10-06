-- Migración: venta por lote (varios animales, un solo trato).
-- Ejecuta esto en tu base de datos EXISTENTE.

CREATE TABLE IF NOT EXISTS venta_lote (
    id              SERIAL PRIMARY KEY,
    tercero_id      INT NOT NULL REFERENCES tercero(id),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    precio_total    DECIMAL(12,2) NOT NULL CHECK (precio_total >= 0),
    factura_folio   VARCHAR(100)
);

ALTER TABLE venta ADD COLUMN IF NOT EXISTS venta_lote_id INT REFERENCES venta_lote(id);
