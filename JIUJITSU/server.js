const express = require('express');
const { compress } = require('@mongodb-js/zstd');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Build a JJS slot object from simple form input
function buildSlot(input) {
  return {
    K_NAME: input.slotType || 'SKILL',
    NAME: input.name || 'Custom Move',
    COOLDOWN: Number(input.cooldown) || 5,
    KEY: Number(input.key) || 1,
    ADD: true,
    DATA: JSON.stringify({
      Line: [
        { K_NAME: 'STATE', STATE: 'IFrame', VALUE: true, TIME: 0.1 },
        {
          K_NAME: 'HITBOX',
          POSITION: '0, 0, 3',
          SIZE: '8, 8, 8',
          DAMAGE: Number(input.damage) || 20,
          STUN: Number(input.stun) || 0.5,
          'ATTACK TYPE': input.attackType || 'Normal'
        },
        {
          K_NAME: 'VELO',
          FORCE: Number(input.force) || 50,
          TIME: 0.3,
          FADE: true,
          TRACK: false,
          'LAST HIT': false
        },
        { K_NAME: 'WAIT', TIME: Number(input.duration) || 0.5 },
        { K_NAME: 'STATE', STATE: 'IFrame', VALUE: false, TIME: 0 }
      ],
      Branch: {},
      Req: [],
      Prop: {}
    })
  };
}

app.post('/api/generate', async (req, res) => {
  try {
    const { moves } = req.body;
    if (!moves || !Array.isArray(moves) || moves.length === 0) {
      return res.status(400).json({ error: 'Нужен хотя бы один move' });
    }

    const slots = moves.map(buildSlot);
    const json = JSON.stringify(slots);
    const bytes = Buffer.from(json, 'utf-8');
    const compressed = await compress(bytes);
    const code = compressed.toString('base64');

    res.json({ code, slotsCount: slots.length, jsonPreview: json.slice(0, 200) + '...' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Decode endpoint — paste a code, get back readable JSON
app.post('/api/decode', async (req, res) => {
  try {
    const { code } = req.body;
    const { decompress } = require('@mongodb-js/zstd');
    const compressed = Buffer.from(code.trim(), 'base64');
    const decompressed = await decompress(compressed);
    const json = JSON.parse(decompressed.toString('utf-8'));
    res.json({ slots: json });
  } catch (err) {
    res.status(400).json({ error: 'Неверный код: ' + err.message });
  }
});

const PORT = 4242;
app.listen(PORT, () => console.log(`JJS Generator: http://localhost:${PORT}`));
