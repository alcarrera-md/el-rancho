INSERT INTO rol (nombre)
VALUES ('Administrador'), ('Veterinario'), ('Trabajador'), ('Auditor')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO usuario (nombre, email, password_hash, rol_id, activo)
SELECT
  'Administradora de integración',
  'admin.integracion@rancho.test',
  crypt('PruebaSegura123!', gen_salt('bf')),
  id,
  true
FROM rol
WHERE nombre = 'Administrador';
