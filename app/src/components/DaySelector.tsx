import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

const DAYS = [
  { num: 1, label: 'א' },
  { num: 2, label: 'ב' },
  { num: 3, label: 'ג' },
  { num: 4, label: 'ד' },
  { num: 5, label: 'ה' },
];

interface Props {
  selected: number | null;
  onSelect: (day: number | null) => void;
}

export default function DaySelector({ selected, onSelect }: Props) {
  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.btn, selected === null && styles.active]}
        onPress={() => onSelect(null)}
      >
        <Text style={[styles.label, selected === null && styles.activeLabel]}>הכל</Text>
      </TouchableOpacity>
      {DAYS.map(d => (
        <TouchableOpacity
          key={d.num}
          style={[styles.btn, selected === d.num && styles.active]}
          onPress={() => onSelect(d.num)}
        >
          <Text style={[styles.label, selected === d.num && styles.activeLabel]}>{d.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    backgroundColor: '#EEF2FF',
  },
  btn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
    elevation: 1,
  },
  active: {
    backgroundColor: '#1565C0',
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1565C0',
  },
  activeLabel: {
    color: '#fff',
  },
});
