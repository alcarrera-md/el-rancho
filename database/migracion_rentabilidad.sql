-- Migración: precio de leche configurable, para el cálculo de rentabilidad por animal.
-- Ejecuta esto en tu base de datos EXISTENTE.

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('precio_leche_litro', 0, 'Precio por litro de leche (para estimar ingresos en el reporte de rentabilidad; déjalo en 0 si no quieres valorar la leche)')
ON CONFLICT (clave) DO NOTHING;
