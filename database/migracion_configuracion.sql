-- Migración: panel de configuración del sistema (umbrales ajustables).
-- Ejecuta esto en tu base de datos EXISTENTE.

CREATE TABLE IF NOT EXISTS configuracion (
    clave       VARCHAR(50) PRIMARY KEY,
    valor       NUMERIC NOT NULL,
    descripcion TEXT NOT NULL
);

INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('dias_alerta_vacuna', 30, 'Con cuántos días de anticipación avisar de una vacuna/dosis próxima'),
    ('dias_alerta_parto', 30, 'Con cuántos días de anticipación avisar de un parto estimado próximo'),
    ('pct_corral_casi_lleno', 90, 'Porcentaje de ocupación a partir del cual un corral se marca como "casi lleno"'),
    ('dias_sin_pesaje_alerta', 60, 'Días sin pesaje antes de recomendar pesar a un animal'),
    ('dias_sin_ordeno_alerta', 3, 'Días sin registro de ordeño antes de generar una alerta'),
    ('pct_caida_leche_alerta', 15, 'Porcentaje de caída en producción de leche (semana vs semana anterior) que dispara una alerta'),
    ('ganancia_diaria_minima_kg', 0.3, 'Ganancia de peso diaria (kg/día) por debajo de la cual se alerta baja ganancia')
ON CONFLICT (clave) DO NOTHING;
