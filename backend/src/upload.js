const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const sufijo = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${sufijo}${path.extname(file.originalname)}`);
  },
});

function filtroImagen(req, file, cb) {
  const tiposPermitidos = /jpeg|jpg|png|webp/;
  const extensionValida = tiposPermitidos.test(path.extname(file.originalname).toLowerCase());
  const mimeValido = tiposPermitidos.test(file.mimetype);
  if (extensionValida && mimeValido) return cb(null, true);
  cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP'));
}

const upload = multer({
  storage,
  fileFilter: filtroImagen,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

module.exports = { upload, UPLOADS_DIR };
