const MODELO_PRINCIPAL = 'gemini-3.6-flash';
const TIMEOUT_PREDETERMINADO_MS = 20000;
const NIVEL_RAZONAMIENTO = 'minimal';
const MAX_REINTENTOS = 1;
const BACKOFF_MS = 400;
const MAX_RETRY_AFTER_MS = 3000;

function enteroAcotado(valor, predeterminado, minimo, maximo) {
  const numero = Number(valor);
  return Number.isInteger(numero) ? Math.min(maximo, Math.max(minimo, numero)) : predeterminado;
}

function configuracionModelos(env = process.env) {
  const principal = String(env.GEMINI_MODEL || MODELO_PRINCIPAL).trim();
  const fallback = String(env.GEMINI_FALLBACK_MODEL || '').trim();
  return {
    modelos: [...new Set([principal, fallback].filter(Boolean))].slice(0, 2),
    timeoutMs: enteroAcotado(env.GEMINI_TIMEOUT_MS, TIMEOUT_PREDETERMINADO_MS, 1000, 30000),
  };
}

function crearErrorGemini(codigo, mensaje, causa) {
  const error = new Error(mensaje, causa ? { cause: causa } : undefined);
  error.code = codigo;
  return error;
}

function codigoHttp(status) {
  if (status === 429) return ['GEMINI_RATE_LIMIT', 'El asistente está temporalmente saturado. Intenta nuevamente en unos segundos.'];
  if (status === 503) return ['GEMINI_SERVICE_UNAVAILABLE', 'El proveedor de IA no está disponible temporalmente.'];
  return ['GEMINI_HTTP_ERROR', `Gemini respondió HTTP ${status}.`];
}

function retryAfterMs(respuesta, ahora = Date.now()) {
  const valor = respuesta.headers?.get?.('retry-after');
  if (!valor) return null;
  const segundos = Number(valor);
  const calculado = Number.isFinite(segundos) ? segundos * 1000 : Date.parse(valor) - ahora;
  return Number.isFinite(calculado) ? Math.max(0, Math.min(MAX_RETRY_AFTER_MS, calculado)) : null;
}

function esperar(ms, signal) {
  if (signal?.aborted) return Promise.reject(crearErrorGemini('GEMINI_TIMEOUT', 'Gemini excedió el tiempo máximo de respuesta.'));
  return new Promise((resolve, reject) => {
    const terminar = () => { signal?.removeEventListener('abort', cancelar); resolve(); };
    const temporizador = setTimeout(terminar, ms);
    const cancelar = () => { clearTimeout(temporizador); reject(crearErrorGemini('GEMINI_TIMEOUT', 'Gemini excedió el tiempo máximo de respuesta.')); };
    signal?.addEventListener('abort', cancelar, { once: true });
  });
}

async function solicitarModelo(modelo, apiKey, contents, opciones) {
  const controlador = new AbortController();
  const cancelar = () => controlador.abort(opciones.signal?.reason);
  if (opciones.signal?.aborted) cancelar();
  else opciones.signal?.addEventListener('abort', cancelar, { once: true });
  const temporizador = setTimeout(() => controlador.abort(), opciones.timeoutMs);
  const inicio = Date.now();
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const cuerpo = { contents };
    if (opciones.systemInstruction) cuerpo.systemInstruction = { parts: [{ text: opciones.systemInstruction }] };
    if (opciones.tools) cuerpo.tools = opciones.tools;
    // mode NONE conserva las declaraciones (necesarias para el historial de
    // llamadas) pero obliga a responder con texto.
    if (opciones.tools && opciones.sinHerramientas) cuerpo.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
    cuerpo.generationConfig = { thinkingConfig: { thinkingLevel: NIVEL_RAZONAMIENTO } };
    if (opciones.responseSchema) Object.assign(cuerpo.generationConfig, { responseMimeType: 'application/json', responseSchema: opciones.responseSchema });
    const respuesta = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: controlador.signal,
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      const [codigo, mensaje] = codigoHttp(respuesta.status);
      const error = crearErrorGemini(codigo, mensaje);
      error.status = respuesta.status;
      error.retryAfterMs = retryAfterMs(respuesta);
      throw error;
    }
    const partes = datos.candidates?.[0]?.content?.parts || [];
    // Gemini puede devolver varias llamadas en paralelo; la parte principal es
    // la primera llamada a función, o la primera parte con texto.
    const parte = partes.find((item) => item.functionCall) || partes.find((item) => typeof item.text === 'string' && !item.thought) || partes[0];
    if (!parte) throw crearErrorGemini('GEMINI_EMPTY_RESPONSE', 'Gemini no devolvió contenido utilizable.');
    return {
      ...parte,
      _meta: {
        modelo, latencia_ms: Date.now() - inicio, partes,
        tokens: datos.usageMetadata ? {
          entrada: datos.usageMetadata.promptTokenCount,
          salida: datos.usageMetadata.candidatesTokenCount,
          total: datos.usageMetadata.totalTokenCount,
        } : null,
      },
    };
  } catch (error) {
    if (controlador.signal.aborted) throw crearErrorGemini('GEMINI_TIMEOUT', 'Gemini excedió el tiempo máximo de respuesta.', error);
    throw error;
  } finally {
    clearTimeout(temporizador);
    opciones.signal?.removeEventListener('abort', cancelar);
  }
}

async function llamarGemini(contents, { tools, responseSchema, signal, timeoutMs, systemInstruction, sinHerramientas } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw crearErrorGemini('GEMINI_NOT_CONFIGURED', 'Gemini no está configurado.');
  const configuracion = configuracionModelos();
  const limite = enteroAcotado(timeoutMs, configuracion.timeoutMs, 1000, 30000);
  const controladorTotal = new AbortController();
  const cancelar = () => controladorTotal.abort(signal?.reason);
  if (signal?.aborted) cancelar(); else signal?.addEventListener('abort', cancelar, { once: true });
  const temporizadorTotal = setTimeout(() => controladorTotal.abort(), limite);
  let ultimoError;
  try {
    for (const [indiceModelo, modelo] of configuracion.modelos.entries()) {
      const intentos = indiceModelo === 0 ? MAX_REINTENTOS + 1 : 1;
      for (let intento = 0; intento < intentos; intento += 1) {
        try {
          const resultado = await solicitarModelo(modelo, apiKey, contents, { tools, responseSchema, systemInstruction, sinHerramientas, signal: controladorTotal.signal, timeoutMs: limite });
          resultado._meta.intentos = intento + 1;
          return resultado;
        } catch (error) {
          ultimoError = error;
          const reintentable = ['GEMINI_RATE_LIMIT', 'GEMINI_SERVICE_UNAVAILABLE'].includes(error.code);
          if (!reintentable || intento + 1 >= intentos || controladorTotal.signal.aborted) break;
          await esperar(error.retryAfterMs ?? BACKOFF_MS * (2 ** intento), controladorTotal.signal);
        }
      }
      if (ultimoError?.code === 'GEMINI_TIMEOUT' || controladorTotal.signal.aborted) break;
    }
  } finally {
    clearTimeout(temporizadorTotal);
    signal?.removeEventListener('abort', cancelar);
  }
  throw crearErrorGemini(ultimoError?.code || 'GEMINI_UNAVAILABLE', ultimoError?.message || 'Gemini no está disponible en este momento.', ultimoError);
}

module.exports = { MODELO_PRINCIPAL, TIMEOUT_PREDETERMINADO_MS, NIVEL_RAZONAMIENTO, MAX_REINTENTOS, configuracionModelos, llamarGemini };
