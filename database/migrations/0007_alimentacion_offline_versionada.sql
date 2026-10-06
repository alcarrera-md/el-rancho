ALTER TABLE insumo
  ADD COLUMN activo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT insumo_version_positiva CHECK (version > 0);

CREATE OR REPLACE FUNCTION incrementar_version_insumo()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW.nombre,
    NEW.tipo,
    NEW.unidad_medida,
    NEW.stock_actual,
    NEW.stock_minimo,
    NEW.fecha_caducidad,
    NEW.activo
  ) IS DISTINCT FROM ROW(
    OLD.nombre,
    OLD.tipo,
    OLD.unidad_medida,
    OLD.stock_actual,
    OLD.stock_minimo,
    OLD.fecha_caducidad,
    OLD.activo
  ) THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_insumo_version
BEFORE UPDATE ON insumo
FOR EACH ROW EXECUTE FUNCTION incrementar_version_insumo();

CREATE INDEX idx_insumo_tipo_version
  ON insumo (tipo, version);
