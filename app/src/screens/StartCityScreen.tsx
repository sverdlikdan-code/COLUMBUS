import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform
} from 'react-native';

const COMMON_CITIES = [
  'תל אביב', 'ירושלים', 'חיפה', 'באר שבע', 'נתניה',
  'פתח תקווה', 'אשדוד', 'ראשון לציון', 'רמת גן', 'הרצליה',
  'רחובות', 'אשקלון', 'בני ברק', 'חולון', 'כפר סבא',
];

interface Props {
  agentName: string;
  onConfirm: (city: string) => void;
  onBack: () => void;
}

export default function StartCityScreen({ agentName, onConfirm, onBack }: Props) {
  const [city, setCity] = useState('');
  const [filtered, setFiltered] = useState<string[]>([]);

  function handleChange(text: string) {
    setCity(text);
    if (text.length > 0) {
      setFiltered(COMMON_CITIES.filter(c => c.includes(text)));
    } else {
      setFiltered([]);
    }
  }

  function handleSelect(c: string) {
    setCity(c);
    setFiltered([]);
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>← חזור</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>COLUMBUS</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.body}>
        <Text style={styles.agentLabel}>{agentName}</Text>
        <Text style={styles.title}>עיר מוצא</Text>
        <Text style={styles.subtitle}>ממה מתחיל המסלול היום?</Text>

        <TextInput
          style={styles.input}
          value={city}
          onChangeText={handleChange}
          placeholder="הקלד עיר..."
          placeholderTextColor="#aaa"
          textAlign="right"
          autoFocus
        />

        {filtered.length > 0 && (
          <View style={styles.suggestions}>
            {filtered.map(c => (
              <TouchableOpacity key={c} style={styles.suggestion} onPress={() => handleSelect(c)}>
                <Text style={styles.suggestionText}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {filtered.length === 0 && city.length === 0 && (
          <View style={styles.quickCities}>
            {COMMON_CITIES.slice(0, 8).map(c => (
              <TouchableOpacity key={c} style={styles.chip} onPress={() => handleSelect(c)}>
                <Text style={styles.chipText}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={[styles.confirmBtn, !city.trim() && styles.confirmDisabled]}
          onPress={() => city.trim() && onConfirm(city.trim())}
          disabled={!city.trim()}
        >
          <Text style={styles.confirmText}>המשך לבניית מסלול ←</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1565C0', paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: { width: 60, padding: 4 },
  backText: { color: '#fff', fontSize: 14 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', letterSpacing: 2 },
  body: { flex: 1, padding: 24, alignItems: 'center' },
  agentLabel: { fontSize: 14, color: '#999', marginBottom: 8, marginTop: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#1565C0', marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#666', marginBottom: 28 },
  input: {
    width: '100%', maxWidth: 400,
    backgroundColor: '#fff', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 18, color: '#222',
    elevation: 3, borderWidth: 2, borderColor: '#1565C0',
  },
  suggestions: {
    width: '100%', maxWidth: 400,
    backgroundColor: '#fff', borderRadius: 10,
    marginTop: 4, elevation: 4,
  },
  suggestion: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  suggestionText: { fontSize: 16, color: '#222', textAlign: 'right' },
  quickCities: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'center', gap: 8, marginTop: 20, maxWidth: 400,
  },
  chip: {
    backgroundColor: '#E3F2FD', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  chipText: { color: '#1565C0', fontWeight: '600', fontSize: 14 },
  confirmBtn: {
    marginTop: 32, backgroundColor: '#1565C0',
    borderRadius: 12, paddingVertical: 16, paddingHorizontal: 40,
    width: '100%', maxWidth: 400, alignItems: 'center',
  },
  confirmDisabled: { backgroundColor: '#B0BEC5' },
  confirmText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
