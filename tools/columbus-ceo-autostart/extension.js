const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function isColumbusWorkspace() {
  return vscode.workspace.workspaceFolders?.some((folder) =>
    folder.uri.fsPath.replace(/\\/g, '/').toLowerCase().includes('columbus')
  );
}

function bootFlagPath() {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return null;
  return path.join(root, '.cursor', 'ceo-boot-pending');
}

function clearBootFlag(flagPath) {
  try {
    fs.unlinkSync(flagPath);
  } catch {
    // ignore
  }
}

exports.activate = (context) => {
  const config = vscode.workspace.getConfiguration('columbusCeoAutostart');
  if (!config.get('enabled', true) || !isColumbusWorkspace()) {
    return;
  }

  const requireBootFlag = config.get('requireBootFlag', true);
  const flagPath = bootFlagPath();
  if (requireBootFlag) {
    if (!flagPath || !fs.existsSync(flagPath)) {
      return;
    }
  }

  const prompt = config.get('prompt', 'CEO?');
  const delayMs = config.get('delayMs', 8000);

  const timer = setTimeout(async () => {
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', prompt);
    } catch (err) {
      console.error('[columbus-ceo-autostart] failed:', err);
    } finally {
      if (flagPath) clearBootFlag(flagPath);
    }
  }, delayMs);

  context.subscriptions.push({ dispose: () => clearTimeout(timer) });
};

exports.deactivate = () => {};
