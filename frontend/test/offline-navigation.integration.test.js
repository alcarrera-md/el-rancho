import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  CAMPO_DB_NOMBRE, _cerrarConexionParaPruebas, guardarBootstrapLocal,
} from '../src/offline/campoDB.js';
import {
  capturarConSoporteOffline, obtenerEstadoCola, TIPO_OPERACION,
} from '../src/offline/colaOperaciones.js';
import { SOPORTE_OFFLINE, soporteOfflineVista } from '../src/offline/support.js';

const almacenamiento = new Map();
globalThis.localStorage = {
  getItem: (clave) => almacenamiento.get(clave) || null,
  setItem: (clave, valor) => almacenamiento.set(clave, String(valor)),
  removeItem: (clave) => almacenamiento.delete(clave),
};

async function borrarBase() {
  await _cerrarConexionParaPruebas();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(CAMPO_DB_NOMBRE);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = resolve;
  });
}

test('navegación parcial abre las superficies de campo y las seis acciones llegan a IndexedDB', async () => {
  await borrarBase();
  const usuario = { id: 81, rol: 'Administrador' };
  const sincronizadoEn = '2026-09-09T12:00:00.000Z';
  await guardarBootstrapLocal(usuario.id, {
    sesion: { usuario_id: usuario.id, expira_en: '2026-09-09T20:00:00.000Z' },
    animales: { datos: [{ id: 10, arete_id: 'MX-10', estado: 'vivo', corral_actual_id: 1, corral_actual: 'Norte', version: 4 }], sincronizado_en: sincronizadoEn },
    corrales: { datos: [{ id: 1, nombre: 'Norte', capacidad_maxima: 20, ocupacion_actual: 1, activo: true }, { id: 2, nombre: 'Sur', capacidad_maxima: 20, ocupacion_actual: 2, activo: true }], sincronizado_en: sincronizadoEn },
    tareas: { datos: [{ id: 30, titulo: 'Revisar agua', estado: 'pendiente', version: 2 }], sincronizado_en: sincronizadoEn },
    insumos: { datos: [{ id: 5, nombre: 'Forraje', stock_actual: 100, unidad_medida: 'kg', version: 3, estado: 'disponible' }], sincronizado_en: sincronizadoEn },
    metadatos: { ultima_sincronizacion_exitosa: sincronizadoEn },
  });

  for (const vista of ['animales', 'corrales', 'tareas', 'seguimiento', 'pesajes', 'alimentacion', 'movimientos']) {
    assert.equal(soporteOfflineVista(vista), SOPORTE_OFFLINE.PARTIAL, vista);
  }
  assert.equal(soporteOfflineVista('sincronizacion'), SOPORTE_OFFLINE.FULL);
  assert.equal(soporteOfflineVista('alertas'), SOPORTE_OFFLINE.ONLINE_ONLY);

  const operaciones = [
    [TIPO_OPERACION.PESAJE, 10, { animal_id: 10, fecha: '2026-09-09', peso_kg: 420 }],
    [TIPO_OPERACION.NOTA, 10, { animal_id: 10, tag: 'General', contenido: 'Sin novedad' }],
    [TIPO_OPERACION.OBSERVACION, 10, { estado_salud: 'observacion' }],
    [TIPO_OPERACION.ALIMENTACION, 10, { animal_id: 10, insumo_id: 5, cantidad: 2, unidad_medida: 'kg', expected_version: 3, stock_observado: 100 }],
    [TIPO_OPERACION.MOVIMIENTO, 10, { corral_id: 2, corral_origen_id: 1, expected_version: 4, estado_observado: 'vivo', destino_ocupacion_observada: 2, destino_capacidad_observada: 20 }],
    [TIPO_OPERACION.COMPLETAR_TAREA, 30, { completada: true, expected_version: 2 }],
  ];

  for (const [tipo, entidadId, payload] of operaciones) {
    const resultado = await capturarConSoporteOffline({ usuario, sinConexion: true, tipo, entidadId, payload, contextoPublico: { entidad: `Prueba ${tipo}` } });
    assert.equal(resultado.offline_pending, true, tipo);
  }
  const cola = await obtenerEstadoCola(usuario.id);
  assert.equal(cola.pendientes, 6);
  assert.deepEqual(new Set(cola.operaciones.map((operacion) => operacion.tipo)), new Set(operaciones.map(([tipo]) => tipo)));
});
