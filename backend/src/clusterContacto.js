const db = require('./db');

// Une conjuntos por componentes conexas (con compresión de camino), para
// agrupar animales transitivamente: si A tuvo contacto con B, y B con C,
// los tres terminan en el mismo conjunto aunque A y C nunca se hayan visto.
class UnionFind {
  constructor() { this.padre = new Map(); }
  encontrar(x) {
    if (!this.padre.has(x)) this.padre.set(x, x);
    let raiz = x;
    while (this.padre.get(raiz) !== raiz) raiz = this.padre.get(raiz);
    let actual = x;
    while (this.padre.get(actual) !== raiz) {
      const siguiente = this.padre.get(actual);
      this.padre.set(actual, raiz);
      actual = siguiente;
    }
    return raiz;
  }
  unir(a, b) {
    const ra = this.encontrar(a);
    const rb = this.encontrar(b);
    if (ra !== rb) this.padre.set(ra, rb);
  }
}

function seSuperponen(i1, i2) {
  const desde = i1.desde > i2.desde ? i1.desde : i2.desde;
  const hasta = i1.hasta < i2.hasta ? i1.hasta : i2.hasta;
  return desde <= hasta;
}

// Reconstruye, a partir del historial real de movimiento_corral, qué animales
// compartieron corral entre sí (y cuándo) dentro de los últimos `diasVentana`
// días, y los agrupa por COMPONENTES CONEXAS del grafo de contacto: si A
// estuvo en el Corral 1 con B, y B estuvo luego en el Corral 2 con C, los
// tres A-B-C quedan en el mismo clúster aunque A y C nunca hayan coincidido
// ni compartan corral actual. Devuelve solo clústeres con 2+ miembros
// (un animal sin contacto con nadie no forma clúster).
async function calcularClustersContacto(diasVentana) {
  const { rows: intervalos } = await db.query(`
    WITH movimientos AS (
      SELECT
        mc.animal_id,
        mc.corral_destino AS corral_id,
        mc.fecha AS desde,
        LEAD(mc.fecha) OVER (PARTITION BY mc.animal_id ORDER BY mc.fecha) AS desde_siguiente,
        a.fecha_baja
      FROM movimiento_corral mc
      JOIN animal a ON a.id = mc.animal_id
    ),
    intervalos AS (
      SELECT animal_id, corral_id, desde,
             COALESCE(desde_siguiente, fecha_baja, CURRENT_DATE) AS hasta
      FROM movimientos
    )
    SELECT
      i.animal_id, i.corral_id,
      GREATEST(i.desde, CURRENT_DATE - $1::int) AS desde,
      LEAST(i.hasta, CURRENT_DATE) AS hasta
    FROM intervalos i
    WHERE i.hasta >= CURRENT_DATE - $1::int AND i.desde <= CURRENT_DATE
    ORDER BY i.corral_id, i.animal_id
  `, [diasVentana]);

  const porCorral = new Map();
  for (const iv of intervalos) {
    if (!porCorral.has(iv.corral_id)) porCorral.set(iv.corral_id, []);
    porCorral.get(iv.corral_id).push(iv);
  }

  const uf = new UnionFind();
  const contactos = [];
  for (const [corralId, lista] of porCorral) {
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i];
        const b = lista[j];
        if (a.animal_id === b.animal_id) continue;
        if (seSuperponen(a, b)) {
          uf.unir(a.animal_id, b.animal_id);
          const desde = a.desde > b.desde ? a.desde : b.desde;
          const hasta = a.hasta < b.hasta ? a.hasta : b.hasta;
          contactos.push({ animal_a: a.animal_id, animal_b: b.animal_id, corral_id: corralId, desde, hasta });
        }
      }
    }
  }

  const grupos = new Map();
  for (const animalId of new Set(intervalos.map((i) => i.animal_id))) {
    const raiz = uf.encontrar(animalId);
    if (!grupos.has(raiz)) grupos.set(raiz, new Set());
    grupos.get(raiz).add(animalId);
  }

  const clusters = [];
  for (const miembros of grupos.values()) {
    if (miembros.size < 2) continue;
    const contactosCluster = contactos.filter((c) => miembros.has(c.animal_a));
    clusters.push({ animal_ids: [...miembros], contactos: contactosCluster });
  }
  return clusters;
}

// Agrega los datos reales de cada animal y el nombre de cada corral a
// clústeres ya calculados. Separado de calcularClustersContacto() para no
// pagar estos JOINs cuando solo se necesita ubicar un clúster por animal_id.
async function enriquecerClusters(clusters) {
  const idsAnimales = [...new Set(clusters.flatMap((c) => c.animal_ids))];
  if (idsAnimales.length === 0) return [];
  const idsCorrales = [...new Set(clusters.flatMap((c) => c.contactos.map((k) => k.corral_id)))];

  const [animales, corrales] = await Promise.all([
    db.query(
      `SELECT a.id, a.arete_id, a.nombre_alias, a.estado, a.estado_salud, a.salud_fecha_inicio,
              a.salud_diagnostico, a.salud_tratamiento, c.nombre AS corral_actual
       FROM animal a LEFT JOIN corral c ON c.id = a.corral_actual_id
       WHERE a.id = ANY($1::int[])`,
      [idsAnimales]
    ),
    idsCorrales.length
      ? db.query('SELECT id, nombre FROM corral WHERE id = ANY($1::int[])', [idsCorrales])
      : Promise.resolve({ rows: [] }),
  ]);
  const animalPorId = new Map(animales.rows.map((a) => [a.id, a]));
  const corralPorId = new Map(corrales.rows.map((c) => [c.id, c.nombre]));

  return clusters.map((cluster) => ({
    animal_ids: cluster.animal_ids,
    animales: cluster.animal_ids.map((id) => animalPorId.get(id)).filter(Boolean),
    corrales: [...new Set(cluster.contactos.map((k) => corralPorId.get(k.corral_id)).filter(Boolean))],
    contactos: cluster.contactos.map((k) => ({
      corral_id: k.corral_id,
      corral_nombre: corralPorId.get(k.corral_id) || null,
      animal_a: k.animal_a,
      animal_b: k.animal_b,
      animal_a_nombre: animalPorId.get(k.animal_a)?.nombre_alias || animalPorId.get(k.animal_a)?.arete_id,
      animal_b_nombre: animalPorId.get(k.animal_b)?.nombre_alias || animalPorId.get(k.animal_b)?.arete_id,
      desde: k.desde,
      hasta: k.hasta,
    })),
  }));
}

module.exports = { calcularClustersContacto, enriquecerClusters };
