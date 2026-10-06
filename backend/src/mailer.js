const nodemailer = require('nodemailer');

let transporter = null;

function obtenerTransporter() {
  if (transporter) return transporter;
  const usuario = process.env.EMAIL_REMITENTE;
  const clave = process.env.EMAIL_APP_PASSWORD;
  if (!usuario || !clave) {
    throw new Error('Faltan EMAIL_REMITENTE y/o EMAIL_APP_PASSWORD en el .env del backend.');
  }
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: usuario, pass: clave },
  });
  return transporter;
}

async function enviarCorreo({ to, subject, html }) {
  const t = obtenerTransporter();
  await t.sendMail({ from: process.env.EMAIL_REMITENTE, to, subject, html });
}

module.exports = { enviarCorreo };
