ALTER TABLE usuario
  ADD COLUMN requiere_cambio_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN sesion_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN password_cambiado_en TIMESTAMPTZ,
  ADD CONSTRAINT usuario_sesion_version_positiva CHECK (sesion_version > 0);
