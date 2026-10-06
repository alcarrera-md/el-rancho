-- =========================================================
-- DATOS DE PRUEBA COMPLETOS
-- Pensados para ver funcionando: árbol genealógico, aviso de
-- consanguinidad, curva de peso, producción de leche, plan
-- sanitario, banderitas de salud, rentabilidad, compras/ventas,
-- tareas y alertas — todo en una sola pasada.
--
-- Se puede pegar y ejecutar de una sola vez en el Query Tool de
-- pgAdmin. Usa aretes nuevos (MX-2001 en adelante) para no chocar
-- con los animales de prueba que ya tengas (MX-0001, MX-0002).
-- =========================================================

-- ---------------------------------------------------------
-- 1) Catálogos: raza, corrales nuevos, trabajador, insumos
-- ---------------------------------------------------------
INSERT INTO raza (nombre) VALUES ('Charolais') ON CONFLICT (nombre) DO NOTHING;

INSERT INTO corral (nombre, descripcion, capacidad_maxima) VALUES ('Corral Vientres', 'Hembras reproductoras', 20);
INSERT INTO corral (nombre, descripcion, capacidad_maxima) VALUES ('Corral Toros', 'Machos reproductores', 8);
INSERT INTO corral (nombre, descripcion, capacidad_maxima) VALUES ('Corral Becerros', 'Crías recién nacidas', 15);

INSERT INTO trabajador (nombre, telefono) VALUES ('Rupertino Vázquez', '555-0004');

INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual, stock_minimo) VALUES ('Vitaminas AD3E', 'medicamento', 'dosis', 50, 10);
INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual, stock_minimo) VALUES ('Sales minerales', 'alimento', 'kg', 200, 30);

-- ---------------------------------------------------------
-- 2) Terceros (proveedor de insumos, proveedor de animales)
--    "Comercializadora del Valle" ya existe desde el seed.sql original (comprador)
-- ---------------------------------------------------------
INSERT INTO tercero (nombre, tipo, contacto) VALUES ('Agroveterinaria del Valle', 'proveedor', '555-8888');
INSERT INTO tercero (nombre, tipo, contacto) VALUES ('Rancho La Esperanza', 'proveedor', '555-7777');

-- ---------------------------------------------------------
-- 3) Familia de animales — 3 generaciones completas, pensada
--    para ver el árbol genealógico y probar el aviso de
--    consanguinidad (Tornado es tío de Lucero y Pecas)
-- ---------------------------------------------------------

-- Abuela y abuelo
INSERT INTO animal (arete_id, nombre_alias, sexo, fecha_nacimiento, raza_id, categoria, corral_actual_id, peso_nacimiento_kg)
VALUES ('MX-2001', 'Reina', 'hembra', CURRENT_DATE - INTERVAL '6 years',
        (SELECT id FROM raza WHERE nombre = 'Brahman'), 'vientre',
        (SELECT id FROM corral WHERE nombre = 'Corral Vientres'), 30);

INSERT INTO animal (arete_id, nombre_alias, sexo, fecha_nacimiento, raza_id, categoria, corral_actual_id, peso_nacimiento_kg)
VALUES ('MX-2002', 'Sultán', 'macho', CURRENT_DATE - INTERVAL '7 years',
        (SELECT id FROM raza WHERE nombre = 'Angus'), 'reproductor',
        (SELECT id FROM corral WHERE nombre = 'Corral Toros'), 35);

-- Madre (hija de Reina y Sultán)
INSERT INTO animal (arete_id, nombre_alias, sexo, fecha_nacimiento, raza_id, madre_id, padre_id, categoria, corral_actual_id, peso_nacimiento_kg)
VALUES ('MX-2003', 'Canela', 'hembra', CURRENT_DATE - INTERVAL '3 years',
        (SELECT id FROM raza WHERE nombre = 'Brahman'),
        (SELECT id FROM animal WHERE arete_id = 'MX-2001'),
        (SELECT id FROM animal WHERE arete_id = 'MX-2002'),
        'vientre', (SELECT id FROM corral WHERE nombre = 'Corral Vientres'), 28);

-- Tío (hermano de Canela — también hijo de Reina y Sultán)
INSERT INTO animal (arete_id, nombre_alias, sexo, fecha_nacimiento, raza_id, madre_id, padre_id, categoria, corral_actual_id, peso_nacimiento_kg)
VALUES ('MX-2004', 'Tornado', 'macho', CURRENT_DATE - INTERVAL '910 days',
        (SELECT id FROM raza WHERE nombre = 'Brahman'),
        (SELECT id FROM animal WHERE arete_id = 'MX-2001'),
        (SELECT id FROM animal WHERE arete_id = 'MX-2002'),
        'reproductor', (SELECT id FROM corral WHERE nombre = 'Corral Toros'), 33);

-- Padre externo, sin parentesco con la familia anterior
INSERT INTO animal (arete_id, nombre_alias, sexo, fecha_nacimiento, raza_id, categoria, corral_actual_id, peso_nacimiento_kg, origen)
VALUES ('MX-2005', 'Duque', 'macho', CURRENT_DATE - INTERVAL '4 years',
        (SELECT id FROM raza WHERE nombre = 'Charolais'), 'reproductor',
        (SELECT id FROM corral WHERE nombre = 'Corral Toros'), 34, 'compra');

-- Cría 1: Lucero (hija de Canela y Duque) — sana
INSERT INTO animal (arete_id, nombre_alias, sexo, fecha_nacimiento, raza_id, madre_id, padre_id, categoria, corral_actual_id, peso_nacimiento_kg, estado_salud)
VALUES ('MX-2006', 'Lucero', 'hembra', CURRENT_DATE - INTERVAL '70 days',
        (SELECT id FROM raza WHERE nombre = 'Brahman'),
        (SELECT id FROM animal WHERE arete_id = 'MX-2003'),
        (SELECT id FROM animal WHERE arete_id = 'MX-2005'),
        'cria', (SELECT id FROM corral WHERE nombre = 'Corral Becerros'), 27, 'sano');

-- Cría 2: Pecas (también hijo de Canela y Duque) — marcado enfermo, para ver la banderita roja
INSERT INTO animal (arete_id, nombre_alias, sexo, fecha_nacimiento, raza_id, madre_id, padre_id, categoria, corral_actual_id, peso_nacimiento_kg, estado_salud, salud_fecha_inicio, salud_diagnostico, salud_tratamiento)
VALUES ('MX-2007', 'Pecas', 'macho', CURRENT_DATE - INTERVAL '45 days',
        (SELECT id FROM raza WHERE nombre = 'Angus'),
        (SELECT id FROM animal WHERE arete_id = 'MX-2003'),
        (SELECT id FROM animal WHERE arete_id = 'MX-2005'),
        'cria', (SELECT id FROM corral WHERE nombre = 'Corral Becerros'), 26,
        'enfermo', CURRENT_DATE - INTERVAL '3 days', 'Diarrea leve', 'Suero oral y antibiótico');

-- Animal de descarte, para venderlo más abajo y ver el historial de ventas
INSERT INTO animal (arete_id, nombre_alias, sexo, fecha_nacimiento, raza_id, categoria, estado)
VALUES ('MX-2008', 'Veterana', 'hembra', CURRENT_DATE - INTERVAL '9 years',
        (SELECT id FROM raza WHERE nombre = 'Holstein'), 'descarte', 'vivo');

-- ---------------------------------------------------------
-- 4) Reproducción: el parto que originó a Lucero (histórico),
--    y una monta pendiente de Reina (para probar "parto próximo")
-- ---------------------------------------------------------
INSERT INTO evento_reproductivo (madre_id, padre_id, tipo_monta, fecha_monta, fecha_parto_estimada, fecha_parto_real, cria_id, resultado)
VALUES (
  (SELECT id FROM animal WHERE arete_id = 'MX-2003'),
  (SELECT id FROM animal WHERE arete_id = 'MX-2005'),
  'inseminacion_artificial', CURRENT_DATE - INTERVAL '353 days', CURRENT_DATE - INTERVAL '70 days', CURRENT_DATE - INTERVAL '70 days',
  (SELECT id FROM animal WHERE arete_id = 'MX-2006'), 'exitoso'
);

INSERT INTO evento_reproductivo (madre_id, padre_id, tipo_monta, fecha_monta, fecha_parto_estimada)
VALUES (
  (SELECT id FROM animal WHERE arete_id = 'MX-2001'),
  (SELECT id FROM animal WHERE arete_id = 'MX-2005'),
  'natural', CURRENT_DATE - INTERVAL '265 days', CURRENT_DATE + INTERVAL '18 days'
);

-- ---------------------------------------------------------
-- 5) Pesajes (curva de crecimiento, ganancia diaria)
-- ---------------------------------------------------------
INSERT INTO pesaje (animal_id, fecha, peso_kg) VALUES
  ((SELECT id FROM animal WHERE arete_id = 'MX-2006'), CURRENT_DATE - INTERVAL '60 days', 32),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2006'), CURRENT_DATE - INTERVAL '30 days', 45),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2006'), CURRENT_DATE - INTERVAL '5 days', 58),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE - INTERVAL '90 days', 410),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE - INTERVAL '20 days', 425);

-- ---------------------------------------------------------
-- 6) Producción de leche de Canela (últimos ~9 días, para ver
--    la gráfica y la comparación semana contra semana)
-- ---------------------------------------------------------
INSERT INTO produccion_leche (animal_id, fecha, turno, litros) VALUES
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE - INTERVAL '9 days', 'manana', 8.5),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE - INTERVAL '9 days', 'tarde', 6.0),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE - INTERVAL '8 days', 'manana', 8.0),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE - INTERVAL '8 days', 'tarde', 5.8),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE - INTERVAL '7 days', 'manana', 8.2),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE - INTERVAL '2 days', 'manana', 6.5),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE - INTERVAL '2 days', 'tarde', 4.5),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE - INTERVAL '1 days', 'manana', 6.0),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE - INTERVAL '1 days', 'tarde', 4.2),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE, 'manana', 5.8);

-- ---------------------------------------------------------
-- 7) Condición corporal
-- ---------------------------------------------------------
INSERT INTO condicion_corporal (animal_id, fecha, puntuacion, observacion) VALUES
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), CURRENT_DATE - INTERVAL '10 days', 3, 'Condición ideal'),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2001'), CURRENT_DATE - INTERVAL '10 days', 2, 'Un poco delgada, vigilar alimentación');

-- ---------------------------------------------------------
-- 8) Eventos de salud (una vacuna aplicada, un tratamiento,
--    y una desparasitación vencida para ver la alerta)
-- ---------------------------------------------------------
INSERT INTO evento_salud (animal_id, tipo, insumo_id, fecha, proxima_dosis) VALUES
  ((SELECT id FROM animal WHERE arete_id = 'MX-2006'), 'vacuna',
   (SELECT id FROM insumo WHERE nombre = 'Vacuna Fiebre Aftosa'),
   CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '20 days');

INSERT INTO evento_salud (animal_id, tipo, insumo_id, enfermedad, descripcion, fecha) VALUES
  ((SELECT id FROM animal WHERE arete_id = 'MX-2007'), 'tratamiento',
   (SELECT id FROM insumo WHERE nombre = 'Vitaminas AD3E'),
   'Diarrea leve', 'Aplicación de suero + antibiótico', CURRENT_DATE - INTERVAL '3 days');

INSERT INTO evento_salud (animal_id, tipo, fecha, proxima_dosis) VALUES
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), 'desparasitacion', CURRENT_DATE - INTERVAL '95 days', CURRENT_DATE - INTERVAL '5 days');

-- ---------------------------------------------------------
-- 9) Alimentación (para que Rentabilidad tenga costos que mostrar)
-- ---------------------------------------------------------
INSERT INTO alimentacion (animal_id, insumo_id, fecha, cantidad) VALUES
  ((SELECT id FROM animal WHERE arete_id = 'MX-2006'), (SELECT id FROM insumo WHERE nombre = 'Concentrado engorde'), CURRENT_DATE - INTERVAL '5 days', 3),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2007'), (SELECT id FROM insumo WHERE nombre = 'Concentrado engorde'), CURRENT_DATE - INTERVAL '5 days', 2.5),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2003'), (SELECT id FROM insumo WHERE nombre = 'Sales minerales'), CURRENT_DATE - INTERVAL '10 days', 5);

-- ---------------------------------------------------------
-- 10) Compra de insumo (le da un costo real al "Concentrado
--     engorde", para que Rentabilidad pueda calcular con datos reales)
-- ---------------------------------------------------------
INSERT INTO compra_insumo (insumo_id, tercero_id, fecha, cantidad, costo_total) VALUES (
  (SELECT id FROM insumo WHERE nombre = 'Concentrado engorde'),
  (SELECT id FROM tercero WHERE nombre = 'Agroveterinaria del Valle'),
  CURRENT_DATE - INTERVAL '20 days', 500, 2500.00
);
UPDATE insumo SET stock_actual = stock_actual + 500 WHERE nombre = 'Concentrado engorde';

-- ---------------------------------------------------------
-- 11) Compra de animal (Duque) y venta (Veterana)
-- ---------------------------------------------------------
INSERT INTO compra_animal (animal_id, tercero_id, fecha, precio, identificacion_previa) VALUES (
  (SELECT id FROM animal WHERE arete_id = 'MX-2005'),
  (SELECT id FROM tercero WHERE nombre = 'Rancho La Esperanza'),
  CURRENT_DATE - INTERVAL '4 years', 8500, 'RE-2022-045'
);

INSERT INTO venta (animal_id, tercero_id, fecha, precio) VALUES (
  (SELECT id FROM animal WHERE arete_id = 'MX-2008'),
  (SELECT id FROM tercero WHERE nombre = 'Comercializadora del Valle' LIMIT 1),
  CURRENT_DATE - INTERVAL '5 days', 15000
);
UPDATE animal SET estado = 'vendido', fecha_baja = CURRENT_DATE - INTERVAL '5 days' WHERE arete_id = 'MX-2008';

-- ---------------------------------------------------------
-- 12) Plan sanitario: plantilla con 3 eventos, asignado a las
--     dos crías (verás "vencido", "próximo" y "aplicado")
-- ---------------------------------------------------------
INSERT INTO plan_sanitario (nombre, descripcion) VALUES ('Protocolo de becerros', 'Vacunación y desparasitación básica desde el nacimiento');

INSERT INTO plan_sanitario_item (plan_id, nombre_evento, tipo, insumo_id, edad_dias, descripcion) VALUES
  ((SELECT id FROM plan_sanitario WHERE nombre = 'Protocolo de becerros'), 'Vacuna Fiebre Aftosa (primera dosis)', 'vacuna',
   (SELECT id FROM insumo WHERE nombre = 'Vacuna Fiebre Aftosa'), 0, 'Aplicar al nacer'),
  ((SELECT id FROM plan_sanitario WHERE nombre = 'Protocolo de becerros'), 'Desparasitación', 'desparasitacion', NULL, 60, 'A los 2 meses'),
  ((SELECT id FROM plan_sanitario WHERE nombre = 'Protocolo de becerros'), 'Refuerzo Fiebre Aftosa', 'vacuna',
   (SELECT id FROM insumo WHERE nombre = 'Vacuna Fiebre Aftosa'), 180, 'Refuerzo a los 6 meses');

INSERT INTO animal_plan_sanitario (animal_id, plan_id) VALUES
  ((SELECT id FROM animal WHERE arete_id = 'MX-2006'), (SELECT id FROM plan_sanitario WHERE nombre = 'Protocolo de becerros')),
  ((SELECT id FROM animal WHERE arete_id = 'MX-2007'), (SELECT id FROM plan_sanitario WHERE nombre = 'Protocolo de becerros'));

-- Enlaza la vacuna que ya le pusiste a Lucero con el ítem del plan,
-- para que aparezca como "Aplicado" en vez de "Vencido"
UPDATE evento_salud SET plan_item_id = (
  SELECT id FROM plan_sanitario_item
  WHERE nombre_evento = 'Vacuna Fiebre Aftosa (primera dosis)'
    AND plan_id = (SELECT id FROM plan_sanitario WHERE nombre = 'Protocolo de becerros')
)
WHERE animal_id = (SELECT id FROM animal WHERE arete_id = 'MX-2006') AND tipo = 'vacuna';

-- ---------------------------------------------------------
-- 13) Tareas (para el calendario y la lista de tareas)
-- ---------------------------------------------------------
INSERT INTO asignacion_tarea (trabajador_id, corral_id, descripcion, fecha, completada) VALUES
  ((SELECT id FROM trabajador WHERE nombre = 'Pedro Campo'), (SELECT id FROM corral WHERE nombre = 'Corral Becerros'), 'Revisar y pesar becerros', CURRENT_DATE, false),
  ((SELECT id FROM trabajador WHERE nombre = 'Rupertino Vázquez'), (SELECT id FROM corral WHERE nombre = 'Corral Toros'), 'Limpiar bebederos', CURRENT_DATE + INTERVAL '2 days', false),
  ((SELECT id FROM trabajador WHERE nombre = 'Pedro Campo'), NULL, 'Aplicar desparasitante a Canela', CURRENT_DATE - INTERVAL '1 days', true);
