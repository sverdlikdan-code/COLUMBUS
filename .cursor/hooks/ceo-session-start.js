#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();

function readSafe(rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return '';
  }
}

function latestSessionFile() {
  const dir = path.join(root, 'VAULT', 'Meeting Notes');
  if (!fs.existsSync(dir)) return null;
  return fs
    .readdirSync(dir)
    .filter((f) => /^session-\d{4}-\d{2}-\d{2}/.test(f) && f.endsWith('.md'))
    .sort()
    .reverse()[0] || null;
}

function indexTail(lines = 12) {
  const idx = readSafe(path.join('VAULT', 'Meeting Notes', '_index.md'));
  if (!idx) return '';
  return idx.split('\n').slice(-lines).join('\n');
}

const ceoAgent = readSafe(path.join('.claude', 'AGENTS', 'ceo-agent', 'AGENT.md'));
const sessionFile = latestSessionFile();
const sessionContent = sessionFile
  ? readSafe(path.join('VAULT', 'Meeting Notes', sessionFile))
  : '';
const lastMeta = readSafe('.cursor/last-session.json');
const tail = indexTail();

const context = [
  '<CEO_AUTO_START>',
  'Ты CEO Agent системы COLUMBUS. Активируйся первым в каждой сессии.',
  'Следуй `.claude/AGENTS/ceo-agent/AGENT.md`, CLAUDE.md и obsidian-vault-workflow.',
  'PRD Audit (Фаза 0) — сообщай только если есть агенты без PRD.',
  'Vault Phase 1 — контекст ниже уже подгружен; одним предложением скажи что загрузил.',
  '',
  '## CEO AGENT.md',
  ceoAgent,
  '',
  sessionFile ? `## Последняя сессия: ${sessionFile}` : '## Последняя сессия: файл не найден',
  sessionContent,
  '',
  lastMeta ? `## Метаданные прошлого закрытия Cursor\n${lastMeta}` : '',
  '',
  '## _index.md (последние записи)',
  tail,
  '',
  'Первый ответ пользователю:',
  '1) «CEO на связи»',
  '2) 2–3 строки — что было в последней сессии',
  '3) «Что делаем?»',
  '</CEO_AUTO_START>',
]
  .filter(Boolean)
  .join('\n');

process.stdout.write(JSON.stringify({ additional_context: context }));
