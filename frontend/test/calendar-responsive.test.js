import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { agruparEventosCalendario, fechaLocalISO, separarAgenda } from '../src/calendario.js';

test('la fecha del calendario se genera en horario local y no mediante UTC', () => {
  assert.equal(fechaLocalISO(new Date(2026, 0, 7, 23, 45)), '2026-01-07');
});

test('la agenda agrupa y ordena eventos por día sin perder información', () => {
  const eventos = [
    { fecha: '2026-08-12T09:00:00Z', titulo: 'Vacuna' },
    { fecha: '2026-08-10', titulo: 'Pesaje' },
    { fecha: '2026-08-12', titulo: 'Parto' },
  ];
  const grupos = agruparEventosCalendario(eventos);
  assert.deepEqual(Object.keys(grupos), ['2026-08-10', '2026-08-12']);
  assert.deepEqual(grupos['2026-08-12'].map((evento) => evento.titulo), ['Parto', 'Vacuna']);
});

test('la agenda separa hoy, próximos y anteriores', () => {
  const agenda = separarAgenda([
    { fecha: '2026-08-09', titulo: 'Anterior' },
    { fecha: '2026-08-10', titulo: 'Hoy' },
    { fecha: '2026-08-11', titulo: 'Próximo' },
  ], '2026-08-10');
  assert.equal(agenda.hoy[0].titulo, 'Hoy');
  assert.equal(agenda.proximos[0][0], '2026-08-11');
  assert.equal(agenda.anteriores[0][0], '2026-08-09');
});

test('el calendario ofrece agenda móvil, cuadrícula progresiva y selector accesible', async () => {
  const componente = await readFile(new URL('../src/components/Calendario.jsx', import.meta.url), 'utf8');
  const estilos = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(componente, /className="calendar-mobile-agenda"/);
  assert.match(componente, /className="calendar-month-view card"/);
  assert.match(componente, /type="date"/);
  assert.match(componente, /aria-label="Mes anterior"/);
  assert.match(componente, /Lo que viene después/);
  assert.match(estilos, /\.calendar-page \{ min-width: 0; overflow-x: clip; \}/);
  assert.match(estilos, /@media \(min-width: 640px\)/);
  assert.match(estilos, /\.calendar-mobile-agenda \{ display: none; \}/);
});

test('la identidad visual usa una sola familia Lucide y conserva únicamente el símbolo propio de marca', async () => {
  const iconos = await readFile(new URL('../src/components/Iconos.jsx', import.meta.url), 'utf8');
  const estilos = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(iconos, /IconoRancho/);
  assert.match(iconos, /from 'lucide-react'/);
  assert.equal((iconos.match(/<svg/g) || []).length, 1);
  assert.doesNotMatch(iconos, /heroicons|tabler-icons/);
  assert.match(estilos, /--earth:/);
  assert.match(estilos, /--cream-deep:/);
  assert.match(estilos, /\.sidebar-brand-mark/);
});
