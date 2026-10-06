-- Datos de ejemplo para probar el flujo completo del sistema
-- Ejecutar DESPUÉS de schema.sql

INSERT INTO rol (nombre) VALUES ('Administrador'), ('Veterinario'), ('Trabajador'), ('Auditor');

INSERT INTO usuario (nombre, email, password_hash, rol_id) VALUES
('Ana Gerente', 'ana@rancho.com', 'hash_bcrypt_aqui', 1),
('Dr. Luis Vet', 'luis@rancho.com', 'hash_bcrypt_aqui', 2);

INSERT INTO trabajador (usuario_id, nombre, telefono) VALUES
(1, 'Ana Gerente', '555-0001'),
(2, 'Dr. Luis Vet', '555-0002');
INSERT INTO trabajador (nombre, telefono) VALUES ('Pedro Campo', '555-0003');

INSERT INTO raza (nombre) VALUES ('Brahman'), ('Angus'), ('Holstein');

INSERT INTO corral (nombre, descripcion, capacidad_maxima, trabajador_id) VALUES
('Corral Crianza A', 'Corral para terneros recién nacidos', 20, 3),
('Corral Engorde 1', 'Corral de engorde principal', 50, 3);

-- Madre ya existente en el hato
INSERT INTO animal (arete_id, sexo, fecha_nacimiento, raza_id, corral_actual_id, peso_nacimiento_kg)
VALUES ('MX-0001', 'hembra', '2022-03-10', 1, 2, 32.5);

-- Cría nueva (nacimiento), hija de la anterior
INSERT INTO animal (arete_id, sexo, fecha_nacimiento, raza_id, madre_id, corral_actual_id, peso_nacimiento_kg, origen)
VALUES ('MX-0002', 'hembra', '2026-06-01', 1, 1, 1, 28.0, 'nacimiento');

-- Insumos
INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual, stock_minimo) VALUES
('Concentrado engorde', 'alimento', 'kg', 500, 50),
('Vacuna Fiebre Aftosa', 'vacuna', 'dosis', 100, 10);

-- Historial de la cría MX-0002 (id=2)
INSERT INTO pesaje (animal_id, fecha, peso_kg) VALUES (2, '2026-07-01', 45.0);
INSERT INTO evento_salud (animal_id, tipo, insumo_id, fecha, proxima_dosis)
VALUES (2, 'vacuna', 2, '2026-06-15', '2026-12-15');
INSERT INTO alimentacion (animal_id, insumo_id, fecha, cantidad) VALUES (2, 1, '2026-07-01', 3.5);

-- Evento reproductivo de la madre (id=1)
INSERT INTO evento_reproductivo (madre_id, tipo_monta, fecha_monta, fecha_parto_estimada, fecha_parto_real, cria_id, resultado)
VALUES (1, 'inseminacion_artificial', '2025-09-01', '2026-06-05', '2026-06-01', 2, 'exitoso');

-- Un tercero para probar ventas
INSERT INTO tercero (nombre, tipo, contacto) VALUES ('Comercializadora del Valle', 'comprador', '555-9999');
