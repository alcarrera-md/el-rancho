-- Migración: reglas de negocio adicionales
-- Ejecuta esto en tu base de datos EXISTENTE.

-- =========================================================
-- 1) No permitir fechas futuras en pesajes, salud y alimentación
--    (evita errores de captura; no aplica a "próxima dosis" ni
--     "fecha de parto estimada", que SÍ deben ser futuras)
-- =========================================================
CREATE OR REPLACE FUNCTION verificar_fecha_no_futura()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.fecha > CURRENT_DATE THEN
        RAISE EXCEPTION 'La fecha (%) no puede ser futura.', NEW.fecha;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pesaje_fecha_no_futura ON pesaje;
CREATE TRIGGER trg_pesaje_fecha_no_futura
BEFORE INSERT OR UPDATE ON pesaje
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_no_futura();

DROP TRIGGER IF EXISTS trg_salud_fecha_no_futura ON evento_salud;
CREATE TRIGGER trg_salud_fecha_no_futura
BEFORE INSERT OR UPDATE ON evento_salud
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_no_futura();

DROP TRIGGER IF EXISTS trg_alimentacion_fecha_no_futura ON alimentacion;
CREATE TRIGGER trg_alimentacion_fecha_no_futura
BEFORE INSERT OR UPDATE ON alimentacion
FOR EACH ROW EXECUTE FUNCTION verificar_fecha_no_futura();

-- =========================================================
-- 2) No permitir aplicar/usar un insumo (vacuna, medicamento,
--    alimento) que ya está caducado a la fecha del evento
-- =========================================================
CREATE OR REPLACE FUNCTION verificar_insumo_no_caducado()
RETURNS TRIGGER AS $$
DECLARE
    caducidad DATE;
    nombre_insumo VARCHAR;
BEGIN
    IF NEW.insumo_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT fecha_caducidad, nombre INTO caducidad, nombre_insumo FROM insumo WHERE id = NEW.insumo_id;

    IF caducidad IS NOT NULL AND caducidad < NEW.fecha THEN
        RAISE EXCEPTION 'El insumo "%" está caducado desde el % y no puede usarse.', nombre_insumo, caducidad;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_salud_insumo_no_caducado ON evento_salud;
CREATE TRIGGER trg_salud_insumo_no_caducado
BEFORE INSERT OR UPDATE ON evento_salud
FOR EACH ROW EXECUTE FUNCTION verificar_insumo_no_caducado();

DROP TRIGGER IF EXISTS trg_alimentacion_insumo_no_caducado ON alimentacion;
CREATE TRIGGER trg_alimentacion_insumo_no_caducado
BEFORE INSERT OR UPDATE ON alimentacion
FOR EACH ROW EXECUTE FUNCTION verificar_insumo_no_caducado();

-- =========================================================
-- 3) No permitir reducir la capacidad de un corral por debajo
--    de su ocupación actual (evita "sobrecupo silencioso")
-- =========================================================
CREATE OR REPLACE FUNCTION verificar_capacidad_corral_editado()
RETURNS TRIGGER AS $$
DECLARE
    ocupacion_actual INT;
BEGIN
    IF NEW.capacidad_maxima < OLD.capacidad_maxima THEN
        SELECT COUNT(*) INTO ocupacion_actual
        FROM animal WHERE corral_actual_id = NEW.id AND estado = 'vivo';

        IF ocupacion_actual > NEW.capacidad_maxima THEN
            RAISE EXCEPTION 'No se puede reducir la capacidad a % porque el corral ya tiene % animales.', NEW.capacidad_maxima, ocupacion_actual;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_corral_capacidad_editada ON corral;
CREATE TRIGGER trg_corral_capacidad_editada
BEFORE UPDATE OF capacidad_maxima ON corral
FOR EACH ROW EXECUTE FUNCTION verificar_capacidad_corral_editado();
