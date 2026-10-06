export function fechaLocalISO(fecha = new Date()) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

export function agruparEventosCalendario(eventos = []) {
  const grupos = new Map();
  [...eventos]
    .filter((evento) => evento?.fecha)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
    .forEach((evento) => {
      const fecha = String(evento.fecha).slice(0, 10);
      if (!grupos.has(fecha)) grupos.set(fecha, []);
      grupos.get(fecha).push(evento);
    });
  return Object.fromEntries(grupos);
}

export function separarAgenda(eventos = [], hoy = fechaLocalISO()) {
  const porDia = agruparEventosCalendario(eventos);
  const dias = Object.entries(porDia);
  return {
    hoy: porDia[hoy] || [],
    proximos: dias.filter(([fecha]) => fecha > hoy),
    anteriores: dias.filter(([fecha]) => fecha < hoy).reverse(),
  };
}
