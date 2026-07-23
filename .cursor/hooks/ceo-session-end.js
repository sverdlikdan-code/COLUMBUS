#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const outDir = path.join(root, '.cursor');
const outFile = path.join(outDir, 'last-session.json');

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdin += chunk;
});
process.stdin.on('end', () => {
  let hookInput = null;
  if (stdin.trim()) {
    try {
      hookInput = JSON.parse(stdin);
    } catch {
      hookInput = { raw: stdin.slice(0, 2000) };
    }
  }

  const vaultDir = path.join(root, 'VAULT', 'Meeting Notes');
  const latestSession =
    fs.existsSync(vaultDir)
      ? fs
          .readdirSync(vaultDir)
          .filter((f) => /^session-\d{4}-\d{2}-\d{2}/.test(f) && f.endsWith('.md'))
          .sort()
          .reverse()[0] || null
      : null;

  const payload = {
    endedAt: new Date().toISOString(),
    latestVaultSession: latestSession,
    workspace: root,
    hookInput,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  process.stdout.write('{}');
});
