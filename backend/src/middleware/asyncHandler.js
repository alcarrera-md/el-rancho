// Envuelve controladores async para no repetir try/catch en cada ruta.
// Cualquier error cae en el manejador global de errores de app.js.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
