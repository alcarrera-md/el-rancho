// Seguimientos conversacionales deterministas (P9.1).
// Traducen preguntas cortas que dependen de la consulta anterior ("¿y cuáles
// son?", "¿y cuántas son vacas?", "¿y el mes pasado?") a una tool autorizada
// con filtros concretos. El contexto solo aporta la tool y sus filtros de la
// última respuesta verificada: las cifras siempre se vuelven a consultar y los
// argumentos resultantes pasan otra vez por policy.js y Zod en ejecutarTool.
// Si ninguna regla aplica se devuelve null y la pregunta sigue su camino normal.

const crypto = require('crypto');
const { normalizarTexto } = require('./asistenteEntidades');
const { interpretarFrasePeriodo } = require('./periodos');

// Sin JWT_SECRET (p. ej. pruebas unitarias) se usa una clave del proceso: un
// reinicio solo invalida el contexto, que se descarta sin error.
const CLAVE_CONTEXTO = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// Filtros que describen al sustantivo del ganadero (ver DEFINICIONES_GANADO).
const SUSTANTIVOS = Object.freeze({
  vacas: { sexo: 'hembra', etapa: 'adulto', agrupar_por: 'categoria' },
  toros: { sexo: 'macho', etapa: 'adulto', agrupar_por: 'categoria' },
  hembras: { sexo: 'hembra' },
  machos: { sexo: 'macho' },
  crias: { etapa: 'cria', agrupar_por: 'categoria' },
});
const PALABRA_SUSTANTIVO = Object.freeze({
  vaca: 'vacas', vacas: 'vacas',
  toro: 'toros', toros: 'toros',
  hembra: 'hembras', hembras: 'hembras',
  macho: 'machos', machos: 'machos',
  cria: 'crias', crias: 'crias', becerro: 'crias', becerros: 'crias', becerra: 'crias', becerras: 'crias',
});

const PERIODO_FRASE = Object.freeze({
  hoy: 'hoy', ayer: 'ayer', manana: 'manana',
  'esta semana': 'esta_semana',
  'este mes': 'mes_actual', 'mes actual': 'mes_actual',
  'mes pasado': 'mes_pasado', 'el mes pasado': 'mes_pasado', 'mes anterior': 'mes_pasado', 'el mes anterior': 'mes_pasado',
  'este ano': 'anio_actual', 'ano actual': 'anio_actual',
  'ano pasado': 'anio_pasado', 'el ano pasado': 'anio_pasado', 'ano anterior': 'anio_pasado', 'el ano anterior': 'anio_pasado',
  'ultimos 7 dias': 'ultimos_7_dias', 'los ultimos 7 dias': 'ultimos_7_dias',
  'ultimos 30 dias': 'ultimos_30_dias', 'los ultimos 30 dias': 'ultimos_30_dias',
  'proximos 7 dias': 'proximos_7_dias', 'los proximos 7 dias': 'proximos_7_dias',
  'proximos 30 dias': 'proximos_30_dias', 'los proximos 30 dias': 'proximos_30_dias',
});

// Consultas que describen el estado actual (no aceptan periodo). Preguntar
// por otra fecha exige reconstruir el hato en el tiempo, que no existe: se
// explica en lugar de reutilizar la cifra actual o enviar la pregunta a Gemini.
const ESTADO_ACTUAL = Object.freeze({
  consultar_animales: 'del hato',
  consultar_corrales: 'de los corrales',
  consultar_inventario: 'del inventario',
  consultar_atencion: 'del hato',
  consultar_alertas: 'de las alertas',
  consultar_condicion_corporal: 'de la condición corporal',
});
// Ventanas de próximas dosis que admite consultar_salud.
const VENTANA_DE_PERIODO = Object.freeze({ hoy: 'hoy', manana: 'manana', esta_semana: 'esta_semana', proximos_7_dias: 'proximos_7_dias' });
const TEXTO_PERIODO = Object.freeze({
  ayer: 'ayer', manana: 'mañana', esta_semana: 'esta semana', mes_actual: 'este mes', mes_pasado: 'el mes pasado',
  anio_actual: 'este año', anio_pasado: 'el año pasado', ultimos_7_dias: 'en los últimos 7 días',
  ultimos_30_dias: 'en los últimos 30 días', proximos_7_dias: 'en los próximos 7 días', proximos_30_dias: 'en los próximos 30 días',
});
const SUJETO_ANIMALES = Object.freeze({
  vacas: 'cuántas vacas había', toros: 'cuántos toros había', hembras: 'cuántas hembras había',
  machos: 'cuántos machos había', crias: 'cuántas crías y becerros había',
});

function sujetoEstadoActual({ tool, argumentos }) {
  if (tool === 'consultar_animales') {
    const clave = Object.keys(SUSTANTIVOS).find((nombre) => Object.entries(SUSTANTIVOS[nombre])
      .filter(([campo]) => campo !== 'agrupar_por')
      .every(([campo, valor]) => argumentos[campo] === valor)
      && ['sexo', 'etapa'].every((campo) => (argumentos[campo] ?? null) === (SUSTANTIVOS[nombre][campo] ?? null)));
    return SUJETO_ANIMALES[clave] || 'cuántos animales había';
  }
  if (tool === 'consultar_corrales') return 'cuál era la ocupación de los corrales';
  if (tool === 'consultar_inventario') return 'cuánto inventario había';
  if (tool === 'consultar_alertas') return 'qué alertas había';
  if (tool === 'consultar_condicion_corporal') return 'cuál era la condición corporal';
  if (tool === 'consultar_salud') return 'qué animales estaban enfermos o en observación';
  return 'qué animales necesitaban atención';
}

// Métricas reproductivas que tienen un conjunto listable detrás.
const METRICAS_LISTABLES = ['prenadas', 'vacias', 'pendientes', 'revision', 'proximos_partos', 'partos', 'servicios', 'perdidas'];
const FILTROS_REPRODUCTIVOS = ['periodo', 'desde', 'hasta', 'corral', 'toro', 'animal', 'estado_reproductivo', 'tipo_servicio'];
// Filtros que acotan un conjunto de animales más allá del estado clínico.
const FILTROS_ANIMAL_RESTRICTIVOS = ['sexo', 'categoria', 'etapa', 'raza', 'corral', 'estado'];
const ORDINALES = Object.freeze({ primera: 0, primero: 0, segunda: 1, segundo: 1, tercera: 2, tercero: 2, cuarta: 3, cuarto: 3, quinta: 4, quinto: 4, sexta: 5, sexto: 5 });

function limpiar(mensaje) {
  return normalizarTexto(mensaje)
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(y|e|entonces|ok|oye|bueno|y entonces)\s+/, '')
    .trim();
}

function sinVacios(objeto) {
  return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== undefined && valor !== null && valor !== ''));
}

function elegirOpcion(texto, pendiente) {
  const opciones = pendiente.opciones || [];
  const limpio = texto.replace(/^(?:(?:la|el|es|con|de|del|arete|numero|opcion)\s+)+/, '').replace(/^#/, '').trim();
  const exacta = opciones.find((opcion) => [opcion.valor, opcion.etiqueta].map(normalizarTexto).includes(limpio)
    || normalizarTexto(opcion.valor).replace(/^id:/, '') === limpio);
  if (exacta) return exacta;
  // "arete 418" dentro de la etiqueta.
  const porArete = opciones.filter((opcion) => new RegExp(`(^|\\s)arete ${limpio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s)`).test(normalizarTexto(opcion.etiqueta)));
  if (porArete.length === 1) return porArete[0];
  const ordinal = limpio.split(' ').find((palabra) => palabra in ORDINALES);
  if (ordinal !== undefined && limpio.split(' ').length <= 2) return opciones[ORDINALES[ordinal]] || null;
  return null;
}

function seguimientoLista(anterior) {
  const { tool, argumentos } = anterior;
  if (tool === 'consultar_animales') {
    return { intencion: 'seguimiento_lista', tool, argumentos: { ...argumentos, modo: 'lista', limite: 25 } };
  }
  if (tool === 'consultar_resumen_reproductivo') {
    const metricas = (argumentos.metricas || []).filter((metrica) => METRICAS_LISTABLES.includes(metrica));
    if (metricas.length !== 1 || (argumentos.metricas || []).length !== 1) return null;
    const filtros = Object.fromEntries(FILTROS_REPRODUCTIVOS.filter((clave) => clave in argumentos).map((clave) => [clave, argumentos[clave]]));
    return { intencion: 'seguimiento_lista', tool: 'listar_detalle_reproductivo', argumentos: { ...filtros, metrica: metricas[0], limite: 25 } };
  }
  if (['consultar_tareas', 'consultar_atencion', 'consultar_movimientos', 'listar_detalle_reproductivo', 'consultar_inventario'].includes(tool)) {
    return { intencion: 'seguimiento_lista', tool, argumentos: { ...argumentos, limite: 25 } };
  }
  return null;
}

function corralDelContexto(anterior) {
  return (anterior.entidades || []).find((entidad) => entidad.tipo === 'corral') || null;
}

function animalDelContexto(anterior) {
  return (anterior.entidades || []).find((entidad) => entidad.tipo === 'animal') || null;
}

// Preguntas sobre el animal en foco ("¿y cuánto pesa?", "¿qué vacunas tiene?").
function seguimientoAnimal(texto, anterior) {
  const animal = animalDelContexto(anterior);
  // "¿Y el pesaje anterior?" tras consultar el peso de un animal.
  if (anterior.tool === 'consultar_peso' && anterior.argumentos.animal
    && /^((cual fue |cuanto fue |cuanto pesaba en )?(el|su) (pesaje|peso) anterior|el anterior|y antes|cuanto pesaba antes)$/.test(texto)) {
    return { intencion: 'peso_anterior', tool: 'consultar_peso', argumentos: { animal: anterior.argumentos.animal, limite: 5 } };
  }
  if (!animal) return null;
  if (/^(cuanto pesa|y cuanto pesa|su peso|cual es su peso|cuando fue su ultimo pesaje|cuando lo pesaron|cuando la pesaron)$/.test(texto)) {
    return { intencion: 'peso_animal', tool: 'consultar_peso', argumentos: { animal: animal.valor, limite: 5 } };
  }
  if (/^((que|cual es su) condicion corporal( tiene)?|su condicion corporal)$/.test(texto)) {
    return { intencion: 'condicion_animal', tool: 'consultar_condicion_corporal', argumentos: { animal: animal.valor, limite: 5 } };
  }
  if (/^(que vacunas tiene|sus vacunas|que vacunas le han puesto)$/.test(texto)) {
    return { intencion: 'salud_animal', tool: 'consultar_salud', argumentos: { enfoque: 'eventos', tipo: 'vacuna', animal: animal.valor, limite: 10 } };
  }
  if (/^(que tratamientos? tiene( registrados?)?|que eventos de salud tiene|su historial (sanitario|de salud))$/.test(texto)) {
    return { intencion: 'salud_animal', tool: 'consultar_salud', argumentos: { enfoque: 'eventos', ...(texto.includes('tratamiento') ? { tipo: 'tratamiento' } : {}), animal: animal.valor, limite: 10 } };
  }
  if (/^(que (paso|pasa) con (el|ella|el animal)|dame (su|un) resumen|su ficha)$/.test(texto)) {
    return { intencion: 'ficha_animal', tool: 'consultar_ficha_animal', argumentos: { identificador: animal.valor } };
  }
  return null;
}

// Condiciones que pueden sumarse a un cruce previo ("¿y cuáles tienen tareas pendientes?").
const CONDICION_CRUCE = [
  [/^(tareas pendientes|alguna tarea pendiente)$/, 'tarea_pendiente'],
  [/^(tareas vencidas|tareas atrasadas|alguna tarea vencida)$/, 'tarea_vencida'],
  [/^(dosis vencidas|vacunas vencidas)$/, 'dosis_vencida'],
  [/^(dosis proximas|vacunas proximas)$/, 'dosis_proxima'],
  [/^(condicion corporal baja|condicion baja)$/, 'condicion_baja'],
  [/^(bajado de peso|bajaron de peso)$/, 'bajo_peso'],
  [/^(enferm[oa]s?)$/, 'enfermo'],
  [/^(en observacion)$/, 'observacion'],
  [/^(prenadas)$/, 'prenada'],
];
const ESTADOS_SALUD_CRUCE = ['enfermo', 'observacion', 'problema_salud'];

function seguimientoCompuesto(texto, anterior) {
  const { tool, argumentos } = anterior;
  const intencion = tool === 'consultar_atencion' ? 'atencion' : 'cruce_animales';
  // "¿Y cuáles son vacas?" → mismo conjunto con el sustantivo.
  const sustantivo = texto.match(/^(?:(?:cuales|cuant[oa]s) )?(?:(?:de (?:esos|esas|ellos|ellas)|son|hay|estan) )*(vacas|toros|hembras|machos)$/);
  if (sustantivo) {
    const filtros = { vacas: { sexo: 'hembra', etapa: 'adulto' }, toros: { sexo: 'macho', etapa: 'adulto' }, hembras: { sexo: 'hembra' }, machos: { sexo: 'macho' } }[sustantivo[1]];
    const { sexo, etapa, ...base } = argumentos;
    if (argumentos.criterios?.some((c) => c === 'prenada' || c === 'proxima_parto') && filtros.sexo === 'macho') return null;
    return { intencion, tool, argumentos: { ...base, ...filtros } };
  }
  // "¿Y cuál tiene más?" sobre un conteo por corral.
  if (tool === 'cruzar_animales' && argumentos.agrupar_por === 'corral' && /^(cual|que corral) (tiene|es el que tiene) mas( animales)?$/.test(texto)) {
    return { intencion: 'corral_mayor', tool, argumentos };
  }
  // "¿Y cuáles tienen tareas pendientes?" → se suma un criterio al cruce.
  const suma = texto.match(/^(?:cuales|cuant[oa]s|que animales|quienes)(?: de (?:esos|esas|ellos|ellas))? (?:tienen|tambien tienen|ademas tienen|estan|tambien estan|han|son) (.+)$/);
  if (suma && tool === 'cruzar_animales' && argumentos.agrupar_por !== 'corral') {
    const criterio = CONDICION_CRUCE.find(([patron]) => patron.test(suma[1]))?.[1];
    if (!criterio) return null;
    const criterios = [...new Set([...(argumentos.criterios || []), criterio])];
    if (criterios.length > 4 || criterios.filter((c) => ESTADOS_SALUD_CRUCE.includes(c)).length > 1) return null;
    return { intencion, tool, argumentos: { ...argumentos, criterios, limite: 25 } };
  }
  return null;
}

// Devuelve { intencion, tool, argumentos, sustantivo? } o null.
function resolverSeguimiento(mensaje, contexto, { catalogo, ahora = new Date() } = {}) {
  if (!contexto?.tool && !contexto?.pendiente) return null;
  const texto = limpiar(mensaje);
  if (!texto || texto.split(' ').length > 9) return null;

  // 1. Respuesta a una pregunta de desambiguación.
  if (contexto.pendiente) {
    const opcion = elegirOpcion(texto, contexto.pendiente);
    if (opcion) {
      return {
        intencion: 'seguimiento_opcion',
        tool: contexto.pendiente.tool,
        argumentos: { ...contexto.pendiente.argumentos, [contexto.pendiente.campo]: opcion.valor },
      };
    }
  }
  if (!contexto.tool) return null;
  const anterior = { tool: contexto.tool, argumentos: contexto.argumentos || {}, entidades: contexto.entidades || [] };

  // P9.2 — animal en foco y registros sanitarios.
  const porAnimal = seguimientoAnimal(texto, anterior);
  if (porAnimal) return porAnimal;
  // "¿Y cuáles vencen pronto?" tras eventos o dosis: mismas condiciones, ventana próxima.
  if (anterior.tool === 'consultar_salud' && anterior.argumentos.enfoque !== 'revision'
    && /^((cuales|que dosis|que vacunas) )?(vencen|tocan|le tocan)( pronto)?$|^(cuales|que dosis|que vacunas) (estan |hay )?vencidas$|^(y )?las vencidas$/.test(texto)) {
    const vencidas = /vencidas/.test(texto);
    return {
      intencion: 'dosis_proximas',
      tool: 'consultar_salud',
      argumentos: sinVacios({ enfoque: 'dosis', ventana: vencidas ? 'vencidas' : 'pronto', tipo: anterior.argumentos.tipo, animal: anterior.argumentos.animal, limite: 25 }),
    };
  }
  // "¿Cuántos están en observación?" es un estado de salud, nunca un corral
  // (P9.2.1). Conserva los demás filtros del conjunto anterior.
  const estadoSalud = texto.match(/^(cuant[oa]s|cuales|quienes)(?: de (?:esos|esas|ellos|ellas))? (?:estan|hay|son)(?: animales)? (en observacion|enferm[oa]s?|san[oa]s?)$/);
  if (estadoSalud) {
    const clave = estadoSalud[2] === 'en observacion' ? 'observacion' : estadoSalud[2].startsWith('enferm') ? 'enfermo' : 'sano';
    // Sobre atención o un cruce, el estado acota ese mismo conjunto; si
    // contradice el estado ya pedido, no se adivina.
    if (anterior.tool === 'consultar_atencion') {
      if (clave === 'sano') return null;
      return { intencion: 'atencion', tool: anterior.tool, argumentos: { ...anterior.argumentos, motivo: clave } };
    }
    if (anterior.tool === 'cruzar_animales' && anterior.argumentos.agrupar_por !== 'corral') {
      const previos = anterior.argumentos.criterios || [];
      const estadoPrevio = previos.find((c) => ESTADOS_SALUD_CRUCE.includes(c));
      if (clave === 'sano' || (estadoPrevio && estadoPrevio !== clave)) return null;
      const criterios = [...new Set([...previos, clave])];
      if (criterios.length > 4) return null;
      return { intencion: 'cruce_animales', tool: anterior.tool, argumentos: { ...anterior.argumentos, criterios, limite: 25 } };
    }
    const { estado_salud, modo, limite, agrupar_por, periodo, desde, hasta, ...base } = anterior.tool === 'consultar_animales' ? anterior.argumentos : {};
    const conservaEstado = base.estado && base.estado !== 'vivo' ? {} : base;
    const lista = !estadoSalud[1].startsWith('cuant');
    return { intencion: 'seguimiento_salud', tool: 'consultar_animales', argumentos: sinVacios({ ...conservaEstado, estado: undefined, estado_salud: clave, modo: lista ? 'lista' : 'resumen', ...(lista ? { limite: 25 } : {}) }) };
  }
  // "¿Y cuáles están en el Corral Engorde 2?": mismo conjunto, acotado a un corral.
  // Exige la palabra "corral" para no confundir estados u otras frases con corrales.
  const enCorral = texto.match(/^(?:cuales|cuantos|cuantas|quienes)(?: de (?:esos|esas|ellos|ellas))? (?:estan|hay) en (?:el )?(corral .+)$/);
  if (enCorral && ['consultar_atencion', 'cruzar_animales'].includes(anterior.tool) && anterior.argumentos.agrupar_por !== 'corral') {
    return { intencion: anterior.tool === 'consultar_atencion' ? 'atencion' : 'cruce_animales', tool: anterior.tool, argumentos: { ...anterior.argumentos, corral: enCorral[1] } };
  }
  if (enCorral && anterior.tool === 'consultar_animales') {
    const { corral, ...base } = anterior.argumentos;
    const lista = !/^(cuantos|cuantas)/.test(texto);
    return { intencion: 'seguimiento_corral', tool: 'consultar_animales', argumentos: { ...base, corral: enCorral[1], modo: lista ? 'lista' : 'resumen', ...(lista ? { limite: 25 } : {}) } };
  }

  // P9.3 — atención y cruces conservan su consulta y solo acotan el conjunto.
  if (['consultar_atencion', 'cruzar_animales'].includes(anterior.tool)) {
    const compuesto = seguimientoCompuesto(texto, anterior);
    if (compuesto) return compuesto;
  }

  // 2. "¿Y cuáles son?" → el conjunto que produjo la cifra anterior.
  if (/^((cuales|quienes)( son| eran| estan| fueron)?( esos| esas| ellos| ellas)?|dime cuales( son)?|muestramel[oa]s|muestral[oa]s|ensenamel[oa]s|dame la lista|la lista|lista(los|las)?|ver (la )?lista|cuales son|(cuales son )?sus nombres|como se llaman|dame sus nombres|dime sus nombres)$/.test(texto)) {
    return seguimientoLista(anterior);
  }

  // 3. "¿Y cuántas son vacas?", "¿y toros?", "¿cuáles son hembras?"
  const sustantivo = texto.match(/^(?:(cuant[oa]s|cuales)\s+)?(?:(?:de (?:esos|esas|ellos|ellas)|son|hay|estan)\s+)*(vacas?|toros?|hembras?|machos?|crias?|becerr[oa]s?)(?:\s+(?:hay|son|tengo|tenemos))?$/);
  if (sustantivo && anterior.tool === 'consultar_animales') {
    const clave = PALABRA_SUSTANTIVO[sustantivo[2]];
    const { sexo, etapa, categoria, agrupar_por, modo, limite, ...base } = anterior.argumentos;
    const lista = sustantivo[1] === 'cuales';
    return {
      intencion: clave,
      sustantivo: clave,
      tool: 'consultar_animales',
      argumentos: sinVacios({ ...base, ...SUSTANTIVOS[clave], modo: lista ? 'lista' : 'resumen', ...(lista ? { limite: 25 } : {}) }),
    };
  }

  // 4. Corral en foco: "¿y cuántos animales tiene?", "¿qué animales tiene?"
  const corral = corralDelContexto(anterior);
  if (corral && ['consultar_corrales', 'consultar_animales'].includes(anterior.tool)) {
    if (/^(cuant[oa]s (animales|cabezas|reses)?\s*(tiene|hay( ahi| ahi dentro)?|contiene)|cuant[oa]s (animales|cabezas) hay (en el|en ese|ahi))$/.test(texto)) {
      return { intencion: 'seguimiento_corral', tool: 'consultar_animales', argumentos: { modo: 'resumen', corral: corral.valor, agrupar_por: 'categoria' } };
    }
    if (/^((que|cuales) animales (tiene|hay( ahi)?|estan ahi)|quienes estan (ahi|en el)|cuales tiene)$/.test(texto)) {
      return { intencion: 'seguimiento_corral', tool: 'consultar_animales', argumentos: { modo: 'lista', corral: corral.valor, limite: 25 } };
    }
  }

  // 5. "¿Cuál de esos tiene tareas vencidas?" solo si el conjunto anterior es
  // exactamente "animales vivos con cierto estado clínico": consultar_tareas
  // cruza por estado de salud y no por otros filtros.
  const tareas = texto.match(/^(?:cual|cuales|que animales|quien|quienes)(?: de (?:esos|esas|ellos|ellas))? tienen? tareas (vencidas|pendientes|atrasadas)$/);
  if (tareas && anterior.tool === 'consultar_animales' && anterior.argumentos.estado_salud
    && !FILTROS_ANIMAL_RESTRICTIVOS.some((clave) => anterior.argumentos[clave])) {
    return {
      intencion: 'seguimiento_tareas',
      tool: 'consultar_tareas',
      argumentos: { estado: tareas[1] === 'pendientes' ? 'pendiente' : 'vencida', estado_salud_animal: anterior.argumentos.estado_salud, limite: 25 },
    };
  }

  // 6. "¿Y el mes pasado?", "¿y en los últimos 3 meses?" → misma consulta en
  // otro periodo; las fechas las calcula interpretarFrasePeriodo en backend.
  const frase = texto.replace(/^(y |en |durante |para |de )+/, '').replace(/^(el|la) (?=(mes|ano) )/, '');
  const interpretado = interpretarFrasePeriodo(texto, ahora) || (PERIODO_FRASE[frase] ? { periodo: PERIODO_FRASE[frase] } : null);
  const periodo = interpretado?.periodo;
  const fechas = interpretado?.periodo === 'personalizado' ? { desde: interpretado.desde, hasta: interpretado.hasta } : {};
  const textoPeriodo = TEXTO_PERIODO[periodo] || (fechas.desde ? `entre el ${fechas.desde} y el ${fechas.hasta}` : 'en ese periodo');
  // Bajas (muertos, vendidos, sacrificados) sí tienen fecha efectiva.
  if (periodo && anterior.tool === 'consultar_animales' && ['muerto', 'vendido', 'sacrificado'].includes(anterior.argumentos.estado)) {
    const { desde, hasta, ...base } = anterior.argumentos;
    return { intencion: 'seguimiento_periodo', tool: 'consultar_animales', argumentos: { ...base, periodo, ...fechas } };
  }
  if (periodo && anterior.tool === 'consultar_salud' && anterior.argumentos.enfoque === 'dosis') {
    if (!VENTANA_DE_PERIODO[periodo]) return null;
    return { intencion: 'dosis_proximas', tool: 'consultar_salud', argumentos: { ...anterior.argumentos, ventana: VENTANA_DE_PERIODO[periodo] } };
  }
  if (periodo && anterior.tool === 'consultar_salud' && anterior.argumentos.enfoque === 'revision') {
    return periodo === 'hoy'
      ? { intencion: 'seguimiento_periodo', tool: anterior.tool, argumentos: anterior.argumentos }
      : { intencion: 'seguimiento_periodo_no_soportado', sinTool: true, texto: `No puedo determinar ${sujetoEstadoActual(anterior)} ${textoPeriodo} porque esta consulta representa el estado actual del hato y todavía no existe una reconstrucción histórica por fecha.` };
  }
  // El peso y la condición de un animal ya son su historial registrado.
  if (periodo && ['consultar_peso', 'consultar_condicion_corporal'].includes(anterior.tool) && anterior.argumentos.animal) return null;
  if (periodo && anterior.tool !== 'consultar_animales' && catalogo?.[anterior.tool]?.declaration?.parameters?.properties?.periodo) {
    const { desde, hasta, pagina, ...base } = anterior.argumentos;
    return { intencion: 'seguimiento_periodo', tool: anterior.tool, argumentos: { ...base, periodo, ...fechas } };
  }
  // "Hoy" sobre una consulta de estado actual es la misma consulta.
  if (periodo === 'hoy' && ESTADO_ACTUAL[anterior.tool]) {
    return { intencion: 'seguimiento_periodo', tool: anterior.tool, argumentos: anterior.argumentos };
  }
  if (periodo && ESTADO_ACTUAL[anterior.tool]) {
    return {
      intencion: 'seguimiento_periodo_no_soportado',
      sinTool: true,
      texto: `No puedo determinar ${sujetoEstadoActual(anterior)} ${textoPeriodo} porque esta consulta representa el estado actual ${ESTADO_ACTUAL[anterior.tool]} y todavía no existe una reconstrucción histórica por fecha.`,
    };
  }
  return null;
}

// Contexto que se devuelve al cliente junto con la respuesta verificada.
function contextoDesdeConsulta(consulta) {
  if (!consulta?.nombre) return null;
  const entidades = [];
  const { nombre, resultado = {}, argumentos = {} } = consulta;
  if (nombre === 'consultar_corrales') {
    const corral = argumentos.corral ? resultado.corrales?.[0] : resultado.mas_lleno;
    if (corral?.id) entidades.push({ tipo: 'corral', valor: `id:${corral.id}`, etiqueta: String(corral.nombre).slice(0, 120) });
  }
  if (nombre === 'consultar_animales' && resultado.filtros?.corral && argumentos.corral) {
    entidades.push({ tipo: 'corral', valor: String(argumentos.corral).slice(0, 100), etiqueta: String(resultado.filtros.corral).slice(0, 120) });
  }
  if (['consultar_ficha_animal', 'consultar_vaca_reproductiva', 'consultar_salud', 'consultar_peso', 'consultar_condicion_corporal'].includes(nombre) && resultado.animal?.arete_id) {
    entidades.push({ tipo: 'animal', valor: String(resultado.animal.arete_id), etiqueta: `#${resultado.animal.arete_id}` });
  }
  if (nombre === 'consultar_tareas' && resultado.trabajador) {
    entidades.push({ tipo: 'trabajador', valor: `id:${resultado.trabajador.id}`, etiqueta: String(resultado.trabajador.nombre).slice(0, 120) });
  }
  return { tool: nombre, argumentos: argumentosSerializables(argumentos), entidades };
}

function argumentosSerializables(argumentos) {
  return Object.fromEntries(Object.entries(argumentos || {})
    .filter(([clave, valor]) => /^[a-z_]{1,40}$/.test(clave) && valor !== undefined)
    .slice(0, 15)
    .map(([clave, valor]) => [clave, typeof valor === 'string' ? valor.slice(0, 120) : Array.isArray(valor) ? valor.slice(0, 8).map((v) => String(v).slice(0, 40)) : valor]));
}

// Pregunta pendiente tras una referencia ambigua: la tool y sus filtros ya
// validados, el campo que falta concretar y las opciones mostradas.
function pendienteDesdeError(error) {
  if (error?.code !== 'REFERENCIA_AMBIGUA' || !error.tool || !error.opcionesEtiquetadas?.length) return null;
  const argumentos = error.argumentosValidados || {};
  const campo = Object.keys(argumentos).find((clave) => argumentos[clave] === error.referencia);
  if (!campo) return null;
  return {
    tool: error.tool,
    argumentos: argumentosSerializables(argumentos),
    campo,
    opciones: error.opcionesEtiquetadas.slice(0, 6).map((opcion) => ({ etiqueta: opcion.etiqueta.slice(0, 120), valor: opcion.valor.slice(0, 100) })),
  };
}

// Línea para Gemini: solo tool y filtros, sin cifras de respuestas anteriores.
function describirContextoParaModelo(contexto) {
  if (!contexto?.tool) return '';
  const filtros = Object.entries(contexto.argumentos || {})
    .filter(([clave]) => !['limite', 'pagina', 'incluir_inactivos'].includes(clave))
    .map(([clave, valor]) => `${clave}=${Array.isArray(valor) ? valor.join('|') : valor}`)
    .join(', ');
  const entidades = (contexto.entidades || []).map((entidad) => `${entidad.tipo} ${entidad.etiqueta} (usa "${entidad.valor}")`).join('; ');
  return `Última consulta verificada: ${contexto.tool}${filtros ? ` con ${filtros}` : ' sin filtros'}${entidades ? `; en foco: ${entidades}` : ''}. Úsala para resolver referencias como "esos", "ese corral" o "¿y cuáles?", y vuelve a consultar los datos.`;
}

function ordenar(valor) {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.keys(valor).sort().map((clave) => [clave, ordenar(valor[clave])]));
  return valor;
}

function calcularFirma(contexto, usuario) {
  const { firma, ...contenido } = contexto;
  return crypto.createHmac('sha256', `asistente-contexto:${CLAVE_CONTEXTO}`)
    .update(`${usuario?.id}|${usuario?.rol}|${JSON.stringify(ordenar(contenido))}`).digest('hex');
}

const VIGENCIA_CONTEXTO_MS = 30 * 60 * 1000;

function firmarContexto(contexto, usuario, ahora = Date.now()) {
  if (!contexto) return null;
  const { firma, ...contenido } = contexto;
  const emitidoEn = Number(ahora);
  const firmado = { ...contenido, expira_en: emitidoEn + VIGENCIA_CONTEXTO_MS };
  return { ...firmado, firma: calcularFirma(firmado, usuario) };
}

// Solo se acepta un contexto emitido para este usuario y rol, dentro de su vigencia.
function verificarContexto(contexto, usuario, ahora = Date.now()) {
  if (!contexto?.firma) return null;
  if (!Number.isSafeInteger(contexto.expira_en) || contexto.expira_en <= Number(ahora)) return null;
  const esperada = Buffer.from(calcularFirma(contexto, usuario), 'hex');
  const recibida = Buffer.from(contexto.firma, 'hex');
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
  const { firma, ...contenido } = contexto;
  return contenido;
}

module.exports = {
  SUSTANTIVOS,
  PALABRA_SUSTANTIVO,
  firmarContexto,
  verificarContexto,
  resolverSeguimiento,
  contextoDesdeConsulta,
  pendienteDesdeError,
  describirContextoParaModelo,
  VIGENCIA_CONTEXTO_MS,
};
