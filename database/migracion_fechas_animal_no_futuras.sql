-- Migración: no permitir fechas futuras en las fechas propias del animal
-- (nacimiento, baja, inicio de estado de salud). Mismo criterio que ya
-- aplica en pesaje, evento_salud, alimentacion, produccion_leche,
-- condicion_corporal y gasto_general (verificar_fecha_no_futura), pero
-- como columna de "animal" se llama distinto, es una función nueva.
-- Ejecuta esto en tu base de datos EXISTENTE.

CREATE OR REPLACE FUNCTION verificar_fechas_animal_no_futuras()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.fecha_nacimiento IS NOT NULL AND NEW.fecha_nacimiento > CURRENT_DATE THEN
        RAISE EXCEPTION 'La fecha de nacimiento (%) no puede ser futura.', NEW.fecha_nacimiento;
    END IF;
    IF NEW.fecha_baja IS NOT NULL AND NEW.fecha_baja > CURRENT_DATE THEN
        RAISE EXCEPTION 'La fecha de baja (%) no puede ser futura.', NEW.fecha_baja;
    END IF;
    IF NEW.salud_fecha_inicio IS NOT NULL AND NEW.salud_fecha_inicio > CURRENT_DATE THEN
        RAISE EXCEPTION 'La fecha de inicio del estado de salud (%) no puede ser futura.', NEW.salud_fecha_inicio;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_animal_fechas_no_futuras ON animal;
CREATE TRIGGER trg_animal_fechas_no_futuras
BEFORE INSERT OR UPDATE ON animal
FOR EACH ROW EXECUTE FUNCTION verificar_fechas_animal_no_futuras();
