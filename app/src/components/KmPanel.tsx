import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Rect, Path, Text as SvgText } from 'react-native-svg';

function ExcelIcon({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28">
      <Rect x="0" y="0" width="28" height="28" rx="5" fill="#1D6F42" />
      <Rect x="14" y="0" width="14" height="14" rx="3" fill="#21A366" />
      <Rect x="14" y="0" width="14" height="14" rx="0" fill="#21A366" />
      <Path d="M8 7 L12 14 L8 21 L10.5 21 L13 16.5 L15.5 21 L18 21 L14 14 L18 7 L15.5 7 L13 11.5 L10.5 7 Z" fill="#fff" />
    </Svg>
  );
}

interface Props {
  priorityKm: number | null;
  aiKm: number | null;
  vertical?: boolean;
  sortMode?: 'priority' | 'ai';
  onToggleSort?: () => void;
  onExport?: () => void;
}

export default function KmPanel({ priorityKm, aiKm, vertical, sortMode, onToggleSort, onExport }: Props) {
  const diff = priorityKm != null && aiKm != null ? priorityKm - aiKm : null;
  const isSaving = diff != null && diff > 0;

  if (vertical) {
    return (
      <View style={vStyles.col}>
        <View style={[vStyles.box, vStyles.priority]}>
          <Text style={vStyles.label}>לפי סדר</Text>
          <Text style={vStyles.value}>{priorityKm != null ? String(priorityKm) : '—'}</Text>
          <Text style={vStyles.unit}>ק״מ</Text>
        </View>
        <View style={[vStyles.box, vStyles.ai]}>
          <Text style={vStyles.label}>סדר AI</Text>
          <Text style={vStyles.value}>{aiKm != null ? String(aiKm) : '—'}</Text>
          <Text style={vStyles.unit}>ק״מ</Text>
        </View>
        <View style={[vStyles.box, isSaving ? vStyles.saving : vStyles.neutral]}>
          <Text style={vStyles.label}>הפרש</Text>
          <Text style={[vStyles.value, diff != null && { color: isSaving ? '#2E7D32' : '#C62828' }]}>
            {diff != null ? `${diff > 0 ? '-' : '+'}${Math.abs(diff)}` : '—'}
          </Text>
          <Text style={vStyles.unit}>ק״מ</Text>
        </View>
        {onExport && (
          <TouchableOpacity style={vStyles.excelBtn} onPress={onExport}>
            <ExcelIcon size={26} />
            <Text style={vStyles.excelLabel}>Excel</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={[styles.box, styles.priority]}>
        <Text style={styles.label}>לפי PRIORITY</Text>
        <Text style={styles.value}>{priorityKm != null ? `${priorityKm}` : '—'}</Text>
        <Text style={styles.unit}>ק״מ</Text>
      </View>
      <View style={[styles.box, styles.ai]}>
        <Text style={styles.label}>סדר AI</Text>
        <Text style={styles.value}>{aiKm != null ? `${aiKm}` : '—'}</Text>
        <Text style={styles.unit}>ק״מ</Text>
      </View>
      <View style={[styles.box, isSaving ? styles.saving : styles.neutral]}>
        <Text style={styles.label}>הפרש</Text>
        <Text style={[styles.value, diff != null && { color: isSaving ? '#4CAF50' : '#EF5350' }]}>
          {diff != null ? `${diff > 0 ? '-' : '+'}${Math.abs(diff)}` : '—'}
        </Text>
        <Text style={styles.unit}>ק״מ</Text>
      </View>
      {onExport && (
        <TouchableOpacity style={[styles.box, styles.excelBox]} onPress={onExport}>
          <ExcelIcon size={24} />
          <Text style={styles.excelLabel}>Excel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Vertical (right sidebar) styles
const vStyles = StyleSheet.create({
  col: {
    width: 70,
    flexDirection: 'column',
    gap: 3,
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: '#0F2044',
  },
  box: {
    flex: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  priority: { borderLeftWidth: 2, borderLeftColor: '#7986CB' },
  ai:       { borderLeftWidth: 2, borderLeftColor: '#C9A84C' },
  saving:   { borderLeftWidth: 2, borderLeftColor: '#4CAF50' },
  neutral:  { borderLeftWidth: 2, borderLeftColor: '#666' },
  label: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    marginBottom: 3,
    fontWeight: '600',
  },
  value: {
    fontSize: 18,
    fontWeight: '900',
    color: '#fff',
  },
  unit: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 1,
    fontWeight: '600',
  },
  toggleWrap: {},
  toggleBtn: {},
  toggleActive: {},
  toggleActiveAi: {},
  toggleText: {},
  toggleTextActive: {},
  recalcBtn: {},
  recalcIcon: {},
  recalcLabel: {},
  excelBtn: {
    borderRadius: 8,
    backgroundColor: '#1B5E20',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 2,
  },
  excelLabel: { fontSize: 10, color: '#A5D6A7', fontWeight: '700', marginTop: 2 },
});

// Horizontal styles
const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 6, gap: 6, backgroundColor: '#0F2044' },
  box: { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.07)' },
  priority: { borderLeftWidth: 2, borderLeftColor: '#7986CB' },
  ai:       { borderLeftWidth: 2, borderLeftColor: '#C9A84C' },
  saving:   { borderLeftWidth: 2, borderLeftColor: '#4CAF50' },
  neutral:  { borderLeftWidth: 2, borderLeftColor: '#555' },
  excelBox: { borderLeftWidth: 2, borderLeftColor: '#1B5E20', backgroundColor: 'rgba(27,94,32,0.3)' },
  label: { fontSize: 9, color: 'rgba(255,255,255,0.55)', marginBottom: 2, textAlign: 'center', fontWeight: '600' },
  value: { fontSize: 16, fontWeight: '900', color: '#fff' },
  unit:  { fontSize: 9, color: 'rgba(255,255,255,0.45)', marginTop: 1 },
  excelLabel: { fontSize: 9, color: '#A5D6A7', fontWeight: '700', marginTop: 2 },
});
