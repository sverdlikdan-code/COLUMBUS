import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  priorityKm: number | null;
  aiKm: number | null;
  vertical?: boolean;
  sortMode?: 'priority' | 'ai';
  onToggleSort?: () => void;
  onExport?: () => void;
  onRecalc?: () => void;
}

export default function KmPanel({ priorityKm, aiKm, vertical, sortMode, onToggleSort, onExport, onRecalc }: Props) {
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
        {/* Toggle: Priority ↔ AI */}
        {onToggleSort && (
          <View style={vStyles.toggleWrap}>
            <TouchableOpacity
              style={[vStyles.toggleBtn, sortMode !== 'ai' && vStyles.toggleActive]}
              onPress={() => sortMode === 'ai' && onToggleSort()}
            >
              <Text style={[vStyles.toggleText, sortMode !== 'ai' && vStyles.toggleTextActive]}>סדר{'\n'}ביקור</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[vStyles.toggleBtn, sortMode === 'ai' && vStyles.toggleActiveAi]}
              onPress={() => sortMode !== 'ai' && onToggleSort()}
            >
              <Text style={[vStyles.toggleText, sortMode === 'ai' && vStyles.toggleTextActive]}>AI{'\n'}סדר</Text>
            </TouchableOpacity>
          </View>
        )}

        {onRecalc && (
          <TouchableOpacity style={vStyles.recalcBtn} onPress={onRecalc}>
            <Text style={vStyles.recalcIcon}>🔁</Text>
            <Text style={vStyles.recalcLabel}>חשב KM</Text>
          </TouchableOpacity>
        )}
        {onExport && (
          <TouchableOpacity style={vStyles.excelBtn} onPress={onExport}>
            <Text style={vStyles.excelIcon}>📊</Text>
            <Text style={vStyles.excelLabel}>Excel</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={[styles.box, styles.priority]}>
        <Text style={styles.label}>KM לפי סדר ביקור</Text>
        <Text style={styles.value}>{priorityKm != null ? `${priorityKm} ק"מ` : '—'}</Text>
      </View>
      <View style={[styles.box, styles.ai]}>
        <Text style={styles.label}>סדר ביקור AI</Text>
        <Text style={styles.value}>{aiKm != null ? `${aiKm} ק"מ` : '—'}</Text>
      </View>
      <View style={[styles.box, isSaving ? styles.saving : styles.neutral]}>
        <Text style={styles.label}>הפרש KM</Text>
        <Text style={styles.value}>
          {diff != null ? `${diff > 0 ? '-' : '+'}${Math.abs(diff)} ק"מ` : '—'}
        </Text>
      </View>
    </View>
  );
}

// Vertical (right sidebar) styles
const vStyles = StyleSheet.create({
  col: {
    width: 64,
    flexDirection: 'column',
    gap: 4,
    paddingVertical: 6,
    paddingRight: 5,
    paddingLeft: 2,
  },
  box: {
    flex: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  priority: { backgroundColor: '#E8EAF6' },
  ai:       { backgroundColor: '#E3F2FD' },
  saving:   { backgroundColor: '#E8F5E9' },
  neutral:  { backgroundColor: '#F5F5F5' },
  label: {
    fontSize: 9,
    color: '#888',
    textAlign: 'center',
    marginBottom: 2,
  },
  value: {
    fontSize: 15,
    fontWeight: '800',
    color: '#222',
  },
  unit: {
    fontSize: 8,
    color: '#aaa',
    marginTop: 1,
  },
  toggleWrap: {
    flexDirection: 'row',
    borderRadius: 7,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#0F2044',
    marginTop: 4,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 5,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  toggleActive: { backgroundColor: '#0F2044' },
  toggleActiveAi: { backgroundColor: '#C9A84C' },
  toggleText: { fontSize: 8, fontWeight: '800', color: '#0F2044', textAlign: 'center', lineHeight: 11 },
  toggleTextActive: { color: '#fff' },
  recalcBtn: {
    borderRadius: 8,
    backgroundColor: '#0F2044',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    marginTop: 2,
  },
  recalcIcon: { fontSize: 14 },
  recalcLabel: { fontSize: 8, color: 'rgba(255,255,255,0.7)', fontWeight: '700', marginTop: 1 },
  excelBtn: {
    borderRadius: 8,
    backgroundColor: '#1B5E20',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    marginTop: 2,
  },
  excelIcon: { fontSize: 14 },
  excelLabel: { fontSize: 8, color: '#A5D6A7', fontWeight: '700', marginTop: 1 },
});

// Horizontal styles (kept for reference)
const styles = StyleSheet.create({
  row: { flexDirection: 'row', padding: 8, gap: 8 },
  box: { flex: 1, borderRadius: 10, padding: 10, alignItems: 'center' },
  priority: { backgroundColor: '#E8EAF6' },
  ai:       { backgroundColor: '#E3F2FD' },
  saving:   { backgroundColor: '#E8F5E9' },
  neutral:  { backgroundColor: '#F5F5F5' },
  label: { fontSize: 11, color: '#666', marginBottom: 4, textAlign: 'center' },
  value: { fontSize: 18, fontWeight: '700', color: '#222' },
});
