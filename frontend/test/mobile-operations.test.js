import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generarPasswordSegura } from '../src/credenciales.js';
import { normalizarTarea, resumirTareas } from '../src/tareas.js';
import { actualizarResumenPorCambioTarea, totalAlertasActivas, totalTareasActivas } from '../src/alertasBadges.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (ruta) => fs.readFileSync(path.join(root, ruta), 'utf8');

test('la contraseña generada es fuerte y no expone ninguna clave existente', () => {
  const password = generarPasswordSegura();
  assert.equal(password.length, 12);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /\d/);
  assert.doesNotMatch(leer('src/components/UsuariosList.jsx'), /password_hash|contraseña existente/i);
});

test('login y administración permiten mostrar u ocultar la contraseña', () => {
  const campo = leer('src/components/CampoPassword.jsx');
  assert.match(campo, /visible \? 'text' : 'password'/);
  assert.match(leer('src/components/Login.jsx'), /CampoPassword/);
  assert.match(leer('src/components/RestablecerPasswordModal.jsx'), /generarPasswordSegura/);
});

test('solo las vistas internas tienen volver y los registros administrativos usan tarjetas móviles', () => {
  const app = leer('src/App.jsx');
  assert.doesNotMatch(app, /vista !== 'inicio' && <BotonVolver/);
  assert.equal((app.match(/<BotonVolver destino="\/animales"/g) || []).length, 1);
  assert.match(leer('src/components/UsuariosList.jsx'), /mobile-record-list/);
  assert.match(leer('src/components/TrabajadoresList.jsx'), /Crear acceso/);
});

test('el calendario mensual y las tarjetas de animales son compactos sin scroll horizontal', () => {
  const css = leer('src/styles.css');
  assert.match(css, /calendar-month-view \{ display: block/);
  assert.match(css, /grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(css, /animal-card \{ display: grid; grid-template-columns: 92px/);
});

test('Trabajador y Veterinario priorizan sus tareas antes de alertas, acciones y clima en móvil', () => {
  const dashboard = leer('src/components/Dashboard.jsx');
  const css = leer('src/styles.css');
  assert.match(dashboard, /\[ROLES\.TRABAJADOR, ROLES\.VETERINARIO\]\.includes/);
  assert.match(dashboard, /esRolOperativo \? 'Mis tareas de hoy' : 'Tareas activas'/);
  assert.match(css, /\.dashboard-rol-operativo \.ops-tasks-widget \{ order: -3; \}/);
  assert.match(css, /\.dashboard-rol-operativo \.ops-attention-widget \{ order: -2; \}/);
  assert.match(css, /\.dashboard-rol-operativo \.ops-actions-widget \{ order: -1; \}/);
});

test('una tarea histórica conserva un corral y una nueva muestra varios', () => {
  const historica = normalizarTarea({ corral_id: 3, corral: 'Norte' });
  const multiple = normalizarTarea({ corrales: [{ id: 3, nombre: 'Norte' }, { id: 4, nombre: 'Sur' }] });
  assert.deepEqual(historica.corral_ids, [3]);
  assert.equal(multiple.corrales_texto, 'Norte, Sur');
});

test('badges dependen del estado real y se refrescan al mutar tareas', () => {
  // P9.2: el conteo vive en alertasService.js, compartido por la ruta y el asistente.
  assert.match(leer('../backend/src/routes/alertas.js'), /obtenerResumenAlertas\(db, \{ config, usuario: req\.usuario \}\)/);
  assert.match(leer('../backend/src/alertasService.js'), /estado IN \('pendiente', 'en_progreso'\)/);
  assert.match(leer('src/components/TareasList.jsx'), /refrescarBadges/);
  assert.doesNotMatch(leer('src/components/Sidebar.jsx'), /set.*badge|marcar.*le/i);
});

test('crear una tarea activa aumenta el badge y completarla lo reduce sin recargar', () => {
  const hoy = '2026-08-30';
  const tarea = { id: 44, descripcion: 'Alimentar corrales', estado: 'pendiente', fecha: hoy };
  const antes = resumirTareas([tarea], hoy).pendientes;
  const despues = resumirTareas([{ ...tarea, estado: 'completada' }], hoy).pendientes;
  assert.equal(antes, 1);
  assert.equal(despues, 0);
  assert.equal(totalTareasActivas({ tareas_pendientes: antes }), 1);
  assert.equal(totalTareasActivas({ tareas_pendientes: despues }), 0);

  const alertasSinTareas = { vacunas_proximas: 1, stock_bajo: 0, partos_proximos: 1, corrales_casi_llenos: 0, plan_sanitario_pendiente: 0 };
  assert.equal(totalAlertasActivas({ ...alertasSinTareas, tareas_pendientes: antes }), 2);
  assert.equal(totalAlertasActivas({ ...alertasSinTareas, tareas_pendientes: despues }), 2);

  const resumenActivo = { ...alertasSinTareas, tareas_pendientes: 3 };
  const resumenCompletado = actualizarResumenPorCambioTarea(resumenActivo, 'pendiente', 'completada');
  assert.equal(resumenCompletado.tareas_pendientes, 2);
  assert.equal(actualizarResumenPorCambioTarea(resumenCompletado, 'completada', 'pendiente').tareas_pendientes, 3);
  assert.equal(actualizarResumenPorCambioTarea({ tareas_pendientes: 0 }, 'pendiente', 'cancelada').tareas_pendientes, 0);

  const tareasList = leer('src/components/TareasList.jsx');
  assert.match(tareasList, /await api\.completarTarea[\s\S]*?registrarCambioTarea\?\.\(tarea\.estado, nuevoEstado\)/);
  assert.match(tareasList, /registrarCambioTarea\?\.\(tarea\.estado, nuevoEstado\)[\s\S]*?await cargar\(\)/);
  assert.match(leer('src/context/AlertasContext.jsx'), /setResumen\(\(actual\) => actualizarResumenPorCambioTarea/);
  assert.match(leer('src/context/AlertasContext.jsx'), /return api\.resumenAlertas\(\)\.then\(setResumen\)/);
});
