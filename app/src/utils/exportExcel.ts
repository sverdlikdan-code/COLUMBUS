import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { utils, write } from 'xlsx';
import { Platform } from 'react-native';
import { Client } from './nearestNeighbor';

const DAY_LABELS: Record<number, string> = { 1:'א', 2:'ב', 3:'ג', 4:'ד', 5:'ה' };

export interface ExportOptions {
  clients: Client[];
  agentName: string;
  managerName: string;
  originalClients: Client[]; // to detect changes
}

function isChanged(client: Client, currentIndex: number, originals: Client[]): boolean {
  const origIndex = originals.findIndex(o => o.custId === client.custId);
  if (origIndex === -1) return false;
  const orig = originals[origIndex];
  return origIndex !== currentIndex || orig.dayNum !== client.dayNum;
}

export async function exportToExcel({ clients, agentName, managerName, originalClients }: ExportOptions) {
  const ws = utils.aoa_to_sheet([]);

  // Header row
  const headers = ['שינוי', 'יום', 'שם לקוח', 'מס. לקוח', 'סדר ביקור', 'שם סוכן', 'מנהל'];
  utils.sheet_add_aoa(ws, [headers], { origin: 'A1' });

  // Data rows
  clients.forEach((c, i) => {
    const changed = isChanged(c, i, originalClients);
    const origDay  = originalClients.find(o => o.custId === c.custId)?.dayNum;
    const dayLabel = DAY_LABELS[c.dayNum] ?? c.dayNum;
    const dayStr   = origDay !== undefined && origDay !== c.dayNum
      ? `${DAY_LABELS[origDay]}→${dayLabel}`   // show day change: א→ב
      : dayLabel;

    const row = [
      changed ? '✓' : '',
      dayStr,
      c.custName,
      c.custId,
      i + 1,
      agentName,
      managerName,
    ];
    utils.sheet_add_aoa(ws, [row], { origin: { r: i + 1, c: 0 } });
  });

  // Column widths
  ws['!cols'] = [
    { wch: 6 },   // שינוי
    { wch: 7 },   // יום
    { wch: 28 },  // שם לקוח
    { wch: 10 },  // מס. לקוח
    { wch: 10 },  // סדר ביקור
    { wch: 22 },  // שם סוכן
    { wch: 12 },  // מנהל
  ];

  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'מסלול');

  const date = new Date().toISOString().slice(0, 10);
  const safeName = agentName.replace(/[^a-zA-Z0-9֐-׿]/g, '_');
  const filename = `route_${safeName}_${date}.xlsx`;

  if (Platform.OS === 'web') {
    const wbout = write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const wbout = write(wb, { type: 'base64', bookType: 'xlsx' });
  const filepath = `${FileSystem.documentDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(filepath, wbout, {
    encoding: FileSystem.EncodingType.Base64,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(filepath, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: `מסלול ${agentName}`,
    });
  }
}
