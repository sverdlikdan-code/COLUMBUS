import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../theme';

const DAYS = [
  { num: 1, label: 'א', name: 'ראשון' },
  { num: 2, label: 'ב', name: 'שני' },
  { num: 3, label: 'ג', name: 'שלישי' },
  { num: 4, label: 'ד', name: 'רביעי' },
  { num: 5, label: 'ה', name: 'חמישי' },
];

interface Props {
  agentName: string;
  startCity: string;
  onSelect: (day: number) => void;
  onBack: () => void;
}

export default function DayScreen({ agentName, startCity, onSelect, onBack }: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.appName}>DILER FORMULA</Text>
          <Text style={styles.subtitle}>{agentName} · {startCity}</Text>
        </View>
      </View>

      <View style={styles.goldLine} />

      <View style={styles.body}>
        <Text style={styles.title}>בחר יום</Text>

        <View style={styles.daysGrid}>
          {DAYS.map(d => (
            <TouchableOpacity
              key={d.num}
              style={styles.dayCard}
              onPress={() => onSelect(d.num)}
            >
              <Text style={styles.dayLetter}>{d.label}</Text>
              <Text style={styles.dayName}>{d.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.cream },
  header: {
    backgroundColor: theme.colors.primary,
    paddingTop: 40, paddingBottom: 20, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center',
  },
  backBtn: { padding: 4, marginRight: 8 },
  backText: { color: '#fff', fontSize: 24, fontWeight: '700' },
  headerCenter: { flex: 1, alignItems: 'center' },
  appName: { fontSize: 24, fontWeight: '800', color: '#fff', letterSpacing: 4 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4 },
  goldLine: { height: 3, backgroundColor: theme.colors.gold },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  title: {
    fontSize: 26, fontWeight: '800', color: theme.colors.primary,
    marginBottom: 32,
  },
  daysGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 16, justifyContent: 'center',
  },
  dayCard: {
    width: 120, height: 120,
    backgroundColor: theme.colors.white,
    borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
    elevation: 4,
    shadowColor: theme.colors.primary,
    shadowOpacity: 0.15, shadowRadius: 8,
    borderTopWidth: 4, borderTopColor: theme.colors.primary,
    gap: 6,
  },
  dayLetter: {
    fontSize: 42, fontWeight: '800',
    color: theme.colors.primary,
  },
  dayName: {
    fontSize: 13, color: theme.colors.textMid, fontWeight: '500',
  },
});
