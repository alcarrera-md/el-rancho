ALTER TABLE animal
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT animal_version_positiva CHECK (version > 0);

-- Serializa cualquier ingreso al mismo destino, incluso si proviene de
-- altas u otros flujos distintos al endpoint de movimientos. Sin este
-- bloqueo, dos transacciones podían leer simultáneamente el último cupo.
CREATE OR REPLACE FUNCTION verificar_capacidad_corral()
RETURNS TRIGGER AS $$
DECLARE
  ocupacion_actual INT;
  capacidad INT;
BEGIN
  SELECT capacidad_maxima INTO capacidad
  FROM corral
  WHERE id = NEW.corral_actual_id
  FOR UPDATE;

  SELECT COUNT(*) INTO ocupacion_actual
  FROM animal
  WHERE corral_actual_id = NEW.corral_actual_id
    AND estado = 'vivo'
    AND id <> COALESCE(NEW.id, -1);

  IF ocupacion_actual >= capacidad THEN
    RAISE EXCEPTION 'El corral % ya alcanzó su capacidad máxima (%).',
      NEW.corral_actual_id, capacidad;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION incrementar_version_ubicacion_animal()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(NEW.corral_actual_id, NEW.estado)
     IS DISTINCT FROM ROW(OLD.corral_actual_id, OLD.estado) THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_animal_version_ubicacion
BEFORE UPDATE ON animal
FOR EACH ROW EXECUTE FUNCTION incrementar_version_ubicacion_animal();

CREATE INDEX idx_animal_corral_version
  ON animal (corral_actual_id, version);
