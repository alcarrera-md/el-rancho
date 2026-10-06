// Resolución conservadora de referencias del asistente (P9.1).
// Cada entidad se busca por niveles, del más exacto al más amplio; se usa el
// primer nivel con coincidencias. Si ese nivel tiene más de una, nunca se
// adivina: se lanza REFERENCIA_AMBIGUA con opciones etiquetadas que el usuario
// puede elegir. Todo es SQL parametrizado; la comparación ignora acentos y
// mayúsculas con translate() porque la base no tiene la extensión unaccent.

const CON_ACENTO = 'áéíóúüàèìòùâêîôûäëïöñ';
const SIN_ACENTO = 'aeiouuaeiouaeiouaeion';

function sqlNormalizado(expresion) {
  return `translate(lower(COALESCE(${expresion},'')),'${CON_ACENTO}','${SIN_ACENTO}')`;
}

function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
}

// Prefijos con los que el ganadero nombra un animal: "vaca 248", "el toro #51",
// "arete 123". Se prueba primero la referencia literal (un animal podría
// llamarse "Toro Bravo") y después sin el prefijo.
const PREFIJO_ANIMAL = /^(?:(?:la|el|al|del|de la)\s+)?(?:vaca|vaquilla|toro|torete|novillo|novilla|becerr[oa]|cria|semental|animal|arete)\s*(?:#|n[uú]m(?:ero)?\.?|no\.)?\s*/i;
const PREFIJO_CORRAL = /^(?:(?:el|al|del)\s+)?corral\s*(?:#|n[uú]m(?:ero)?\.?|no\.)?\s*/i;
const REFERENCIA_POR_ID = /^id:(\d{1,9})$/;

function variantes(referencia, prefijo) {
  const literal = String(referencia).trim().replace(/^#/, '').trim();
  const sinPrefijo = literal.replace(prefijo, '').replace(/^#/, '').trim();
  return [...new Set([literal, sinPrefijo].filter(Boolean))];
}

function errorEntidad(codigo, mensaje, extra = {}) {
  const error = new Error(mensaje);
  error.code = codigo;
  Object.assign(error, extra);
  return error;
}

function etiquetaAnimal(fila) {
  const base = fila.nombre_alias ? `${fila.nombre_alias} · arete ${fila.arete_id}` : `arete ${fila.arete_id}`;
  return fila.estado && fila.estado !== 'vivo' ? `${base} · ${fila.estado}` : base;
}

const TIPOS = Object.freeze({
  animal: {
    singular: 'animal', plural: 'animales', llamados: 'llamados', noEncontrado: 'ANIMAL_NO_ENCONTRADO',
    mensajeNoEncontrado: (ref) => `No encontré un animal identificado como “${ref}”.`,
    opcion: (fila) => ({ etiqueta: etiquetaAnimal(fila), valor: fila.arete_id }),
  },
  corral: {
    singular: 'corral', plural: 'corrales', llamados: 'llamados', noEncontrado: 'CORRAL_NO_ENCONTRADO',
    mensajeNoEncontrado: (ref) => `No encontré el corral “${ref}”.`,
    opcion: (fila) => ({ etiqueta: fila.nombre, valor: `id:${fila.id}` }),
  },
  trabajador: {
    singular: 'trabajador', plural: 'trabajadores', llamados: 'llamados', noEncontrado: 'TRABAJADOR_NO_ENCONTRADO',
    mensajeNoEncontrado: (ref) => `No encontré un trabajador llamado “${ref}”.`,
    opcion: (fila) => ({ etiqueta: fila.activo === false ? `${fila.nombre} · inactivo` : fila.nombre, valor: `id:${fila.id}` }),
  },
  insumo: {
    singular: 'insumo', plural: 'insumos', llamados: 'llamados', noEncontrado: 'INSUMO_NO_ENCONTRADO',
    mensajeNoEncontrado: (ref) => `No encontré el insumo “${ref}”.`,
    opcion: (fila) => ({ etiqueta: `${fila.nombre} (${fila.unidad_medida})`, valor: `id:${fila.id}` }),
  },
});

// filas traen la columna "nivel"; solo cuenta el mejor nivel presente.
function elegir(filas, referencia, tipo) {
  const def = TIPOS[tipo];
  if (!filas.length) throw errorEntidad(def.noEncontrado, def.mensajeNoEncontrado(referencia), { referencia });
  const mejor = Math.min(...filas.map((fila) => Number(fila.nivel)));
  const candidatas = filas.filter((fila) => Number(fila.nivel) === mejor);
  if (candidatas.length === 1) {
    const { nivel, ...elegida } = candidatas[0];
    return elegida;
  }
  const opciones = candidatas.map(({ nivel, ...fila }) => fila);
  const mensaje = mejor === NIVEL.parcial
    ? `Encontré ${opciones.length} ${def.plural} que coinciden con “${referencia}”.`
    : `Hay ${opciones.length} ${def.plural} ${def.llamados} “${referencia}”.`;
  throw errorEntidad('REFERENCIA_AMBIGUA', mensaje, {
    referencia, entidad: tipo, opciones, opcionesEtiquetadas: opciones.map(def.opcion),
  });
}

const NIVEL = Object.freeze({ id: 0, clave: 1, nombre: 2, idNumerico: 3, parcial: 4 });

async function resolverAnimal(client, referencia, { sexo } = {}) {
  const porId = String(referencia).trim().match(REFERENCIA_POR_ID);
  const lista = variantes(referencia, PREFIJO_ANIMAL);
  const normalizadas = lista.map(normalizarTexto);
  const numericas = lista.filter((valor) => /^\d{1,9}$/.test(valor)).map(Number);
  const parciales = normalizadas.filter((valor) => valor.length >= 3);
  const nombre = sqlNormalizado('nombre_alias');
  const { rows } = await client.query(`
    SELECT id,arete_id,nombre_alias,sexo,estado,categoria,
      CASE WHEN id=$5::int THEN ${NIVEL.id}
           WHEN LOWER(arete_id)=ANY($2::text[]) THEN ${NIVEL.clave}
           WHEN ${nombre}=ANY($3::text[]) THEN ${NIVEL.nombre}
           WHEN id=ANY($4::int[]) THEN ${NIVEL.idNumerico}
           ELSE ${NIVEL.parcial} END nivel
    FROM animal
    WHERE ($1::text IS NULL OR sexo=$1)
      AND (id=$5::int OR LOWER(arete_id)=ANY($2::text[]) OR ${nombre}=ANY($3::text[]) OR id=ANY($4::int[])
        OR EXISTS (SELECT 1 FROM unnest($6::text[]) p WHERE strpos(${nombre},p)>0))
    ORDER BY nivel,arete_id LIMIT 12`,
  [sexo || null, lista.map((v) => v.toLowerCase()), normalizadas, numericas, porId ? Number(porId[1]) : null, parciales]);
  return elegir(rows, referencia, 'animal');
}

async function resolverCorral(client, referencia) {
  const porId = String(referencia).trim().match(REFERENCIA_POR_ID);
  const lista = variantes(referencia, PREFIJO_CORRAL);
  const normalizadas = lista.map(normalizarTexto);
  const numericas = lista.filter((valor) => /^\d{1,9}$/.test(valor)).map(Number);
  const parciales = normalizadas.filter((valor) => valor.length >= 3);
  const nombre = sqlNormalizado('nombre');
  const { rows } = await client.query(`
    SELECT id,nombre,
      CASE WHEN id=$4::int THEN ${NIVEL.id}
           WHEN ${nombre}=ANY($1::text[]) THEN ${NIVEL.nombre}
           WHEN id=ANY($2::int[]) THEN ${NIVEL.idNumerico}
           ELSE ${NIVEL.parcial} END nivel
    FROM corral
    WHERE id=$4::int OR ${nombre}=ANY($1::text[]) OR id=ANY($2::int[])
       OR EXISTS (SELECT 1 FROM unnest($3::text[]) p WHERE strpos(${nombre},p)>0)
    ORDER BY nivel,nombre LIMIT 12`,
  [normalizadas, numericas, parciales, porId ? Number(porId[1]) : null]);
  return elegir(rows, referencia, 'corral');
}

async function resolverPorNombre(client, referencia, { tabla, columnas, tipo }) {
  const porId = String(referencia).trim().match(REFERENCIA_POR_ID);
  const literal = String(referencia).trim().replace(/^#/, '');
  const normalizada = normalizarTexto(literal);
  const nombre = sqlNormalizado('nombre');
  const { rows } = await client.query(`
    SELECT ${columnas},
      CASE WHEN id=$3::int THEN ${NIVEL.id}
           WHEN ${nombre}=$1 THEN ${NIVEL.nombre}
           WHEN id::text=$4 THEN ${NIVEL.idNumerico}
           ELSE ${NIVEL.parcial} END nivel
    FROM ${tabla}
    WHERE id=$3::int OR ${nombre}=$1 OR id::text=$4 OR ($2 AND strpos(${nombre},$1)>0)
    ORDER BY nivel,nombre LIMIT 12`,
  [normalizada, normalizada.length >= 3, porId ? Number(porId[1]) : null, /^\d{1,9}$/.test(literal) ? literal : null]);
  return elegir(rows, referencia, tipo);
}

function resolverTrabajador(client, referencia) {
  return resolverPorNombre(client, referencia, { tabla: 'trabajador', columnas: 'id,nombre,activo', tipo: 'trabajador' });
}

function resolverInsumo(client, referencia) {
  return resolverPorNombre(client, referencia, { tabla: 'insumo', columnas: 'id,nombre,tipo,unidad_medida,activo', tipo: 'insumo' });
}

module.exports = {
  normalizarTexto,
  etiquetaAnimal,
  resolverAnimal,
  resolverCorral,
  resolverTrabajador,
  resolverInsumo,
};
