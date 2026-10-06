const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { construirBootstrap } = require('../syncBootstrap');

const router = express.Router();

router.get('/bootstrap', asyncHandler(async (req, res) => {
  res.json(await construirBootstrap(db, req.usuario));
}));

module.exports = router;
