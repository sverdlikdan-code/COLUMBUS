/**
 * loader.js — reads בררת מחדל FOR-ALL.csv
 * Returns { bay → { makat, fam, name } } for a given section name.
 * Section names: 'קפוא' | 'חלבי' | 'דגים' | 'דג יבש'
 */
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'FOR-ALL.csv');

function loadBreiraDefault(sectionName) {
  const raw   = fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '');
  const lines = raw.split('\n').filter(l => l.trim());

  // Line 1 = headers
  const headers = lines[0].split(',').map(h => h.trim());
  const idx = {
    mahlaka: headers.indexOf('מחלקה'),
    bay:     headers.indexOf('בי'),
    makat:   headers.indexOf('מקט'),
    name:    headers.indexOf('שם'),
    fam:     headers.indexOf('משפחה'),
  };

  if (idx.mahlaka < 0 || idx.bay < 0 || idx.makat < 0)
    throw new Error(`Missing columns in FOR-ALL.csv. Found: ${headers.join(', ')}`);

  const result = {};
  for (let i = 1; i < lines.length; i++) {
    const cols    = lines[i].split(',');
    const mahlaka = (cols[idx.mahlaka] || '').trim();
    if (mahlaka !== sectionName) continue;
    const bay   = (cols[idx.bay]   || '').trim();
    const makat = (cols[idx.makat] || '').trim();
    const name  = idx.name >= 0 ? (cols[idx.name] || '').trim() || null : null;
    const fam   = idx.fam  >= 0 ? (cols[idx.fam]  || '').trim() || null : null;
    if (bay && makat) result[bay] = { makat, fam, name };
  }
  return result;
}

module.exports = { loadBreiraDefault };
