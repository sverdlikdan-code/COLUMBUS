import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  StyleSheet, ActivityIndicator
} from 'react-native';
import * as Location from 'expo-location';
import { fetchManagers, fetchManagerAgents } from '../api/client';
import { theme } from '../theme';

interface ManagerAgent { agentCode: string; agentName: string; }
interface Manager { managerCode: string; }

const DEMO_MANAGERS = ['VLAD', 'ALEXEY', 'NATALYA', 'SVETA', 'ANATOL', 'SADRAN+'];
const DEMO_AGENTS: Record<string, ManagerAgent[]> = {
  ANATOL:    [{ agentCode: '238', agentName: 'וצ\'סלב שולקין' }, { agentCode: '112', agentName: 'סרגיי שפונט' }, { agentCode: '123', agentName: 'קונסטנטין קפוסטינסקי' }, { agentCode: '131', agentName: 'אלברט מרדכייב' }],
  ALEXEY:    [{ agentCode: '110', agentName: 'אולג גלדקיך' }, { agentCode: '258', agentName: 'דוד גומרשטדט' }, { agentCode: '149', agentName: 'יבגני אפנסייב' }],
  NATALYA:   [{ agentCode: '129', agentName: 'אלכסיי סביצקי' }, { agentCode: '136', agentName: 'דמיטרי שפילמן' }, { agentCode: '239', agentName: 'דן אוחיון' }, { agentCode: '114', agentName: 'רוסלן שפילמן' }],
  SVETA:     [{ agentCode: '260', agentName: 'אדלינה גולדפאיין' }, { agentCode: '126', agentName: 'אולג בלז\'' }, { agentCode: '215', agentName: 'אלכסנדר סוסנוב' }, { agentCode: '257', agentName: 'זויה ציגנקוב' }],
  VLAD:      [{ agentCode: '62', agentName: 'אוריאל חיימצ\'אייב' }, { agentCode: '138', agentName: 'טוליק בסרייב' }, { agentCode: '275', agentName: 'עירית בלובה' }, { agentCode: '250', agentName: 'מקסים קרילוב' }, { agentCode: '234', agentName: 'מרגריטה מאקארצ\'בה' }],
  'SADRAN+': [{ agentCode: '272', agentName: 'אלכס שלפקוב' }, { agentCode: '235', agentName: 'אלכסיי נובוסלסקי' }, { agentCode: '256', agentName: 'יבגני בלקיטני' }, { agentCode: '59', agentName: 'רומן איגנטייב' }],
};
const DAYS = [
  { num: 1, label: 'א' }, { num: 2, label: 'ב' }, { num: 3, label: 'ג' },
  { num: 4, label: 'ד' }, { num: 5, label: 'ה' },
];
const CITIES = [
  'תל אביב','ירושלים','חיפה','ראשון לציון','פתח תקווה','אשדוד',
  'נתניה','באר שבע','בני ברק','רמת גן','בת ים','הרצליה',
  'חולון','רחובות','כפר סבא','מודיעין','לוד','רמלה',
  'הוד השרון','רעננה','גבעתיים','קרית גת','אשקלון','עכו',
  'נהריה','צפת','טבריה','אילת','אריאל','מעלה אדומים',
]; // used only for autocomplete dropdown when typing manually

interface Props {
  onStart: (agentCode: string, agentName: string, managerName: string, city: string, day: number) => void;
}

export default function SetupScreen({ onStart }: Props) {
  const [managers, setManagers] = useState<string[]>([]);
  const [agents, setAgents] = useState<ManagerAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const [manager, setManager] = useState<string | null>(null);
  const [agent, setAgent] = useState<ManagerAgent | null>(null);
  const [city, setCity] = useState('');
  const [day, setDay] = useState<number | null>(null);
  const [cityInput, setCityInput] = useState('');
  const [showCities, setShowCities] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);

  const canStart = manager && agent && city && day;

  useEffect(() => {
    fetchManagers()
      .then((data: Manager[]) => {
        const list = data.map(m => m.managerCode).filter(Boolean);
        setManagers(list.length > 0 ? list : DEMO_MANAGERS);
      })
      .catch(() => setManagers(DEMO_MANAGERS))
      .finally(() => setLoading(false));
  }, []);

  async function pickManager(mgr: string) {
    setManager(mgr);
    setAgent(null);
    try {
      const data: ManagerAgent[] = await fetchManagerAgents(mgr);
      setAgents(data.length > 0 ? data : (DEMO_AGENTS[mgr] ?? []));
    } catch {
      setAgents(DEMO_AGENTS[mgr] ?? []);
    }
  }

  function pickCity(c: string) {
    setCity(c);
    setCityInput(c);
    setShowCities(false);
  }

  async function useGeoLocation() {
    setGeoLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${loc.coords.latitude}&lon=${loc.coords.longitude}&format=json&accept-language=he`,
        { headers: { 'User-Agent': 'DillerFormulaApp/1.0' } }
      );
      const data = await res.json();
      const a = data.address ?? {};
      const cityName = a.city || a.town || a.village || a.suburb || '';
      const street   = [a.road, a.house_number].filter(Boolean).join(' ');
      const full     = [cityName, street].filter(Boolean).join(', ') || 'מיקום נוכחי';
      pickCity(full);
    } catch {
      pickCity('מיקום נוכחי');
    } finally {
      setGeoLoading(false);
    }
  }

  return (
    <View style={styles.root}>

      {/* ── Heraldic Header ── */}
      <View style={styles.header}>

        {/* Crest + title */}
        <View style={styles.headerCenter}>
          <View style={styles.crestOuter}>
            <View style={styles.crestInner}>
              <Text style={styles.crestLetter}>D</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <Text style={styles.appName}>DILLER FORMULA</Text>
          <Text style={styles.appSub}>AGENT APP</Text>
        </View>

      </View>

      <View style={styles.goldLine} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* 1. Manager */}
        <Section label="בחר מנהל" done={!!manager}>
          {loading ? <ActivityIndicator color={theme.colors.primary} /> : (
            <View style={styles.chipRow}>
              {managers.map(mgr => (
                <TouchableOpacity
                  key={mgr}
                  style={[styles.chip, manager === mgr && styles.chipActive]}
                  onPress={() => pickManager(mgr)}
                >
                  <Text style={[styles.chipText, manager === mgr && styles.chipTextActive]}>{mgr}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Section>

        {/* 2. Agent */}
        {manager && (
          <Section label="בחר סוכן" done={!!agent}>
            <View style={styles.chipRow}>
              {agents.map(a => (
                <TouchableOpacity
                  key={a.agentCode}
                  style={[styles.agentChip, agent?.agentCode === a.agentCode && styles.chipActive]}
                  onPress={() => setAgent(a)}
                >
                  <Text style={[styles.agentChipText, agent?.agentCode === a.agentCode && styles.chipTextActive]}>
                    {a.agentName}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Section>
        )}

        {/* 3. City */}
        {agent && (
          <Section label="עיר וכתובת יציאה" done={!!city}>

            {city ? (
              /* ── Result: compact pill with city + address ── */
              <View style={styles.locationResult}>
                <View style={styles.locationPin}>
                  <Text style={styles.locationPinIcon}>📍</Text>
                </View>
                <Text style={styles.locationText} numberOfLines={2}>{city}</Text>
                <TouchableOpacity
                  style={styles.changeBtn}
                  onPress={() => { setCity(''); setCityInput(''); }}
                >
                  <Text style={styles.changeBtnText}>שנה</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* ── No city yet: geo button + manual input ── */
              <>
                <TouchableOpacity
                  style={styles.geoBtnFull}
                  onPress={useGeoLocation}
                  disabled={geoLoading}
                >
                  {geoLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Text style={styles.geoIcon}>📍</Text>
                      <Text style={styles.geoBtnText}>קבע מיקום נוכחי</Text>
                    </>
                  )}
                </TouchableOpacity>

                <Text style={styles.orText}>— או הקלד ידנית —</Text>

                <TextInput
                  style={styles.input}
                  value={cityInput}
                  onChangeText={t => { setCityInput(t); setCity(t); setShowCities(t.length > 0); }}
                  placeholder="עיר, רחוב..."
                  placeholderTextColor="#aaa"
                  textAlign="right"
                />
                {showCities && (
                  <View style={styles.suggestions}>
                    {CITIES.filter(c => c.includes(cityInput)).map(c => (
                      <TouchableOpacity key={c} style={styles.suggestion} onPress={() => pickCity(c)}>
                        <Text style={styles.suggestionText}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

          </Section>
        )}

        {/* 4. Day */}
        {city && (
          <Section label="בחר יום" done={!!day}>
            <View style={styles.dayRow}>
              {DAYS.map(d => (
                <TouchableOpacity
                  key={d.num}
                  style={[styles.dayBtn, day === d.num && styles.dayBtnActive]}
                  onPress={() => setDay(d.num)}
                >
                  <Text style={[styles.dayLabel, day === d.num && styles.dayLabelActive]}>{d.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Section>
        )}

        {/* Start button */}
        {canStart && (
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => onStart(agent!.agentCode, agent!.agentName, manager!, city, day!)}
          >
            <Text style={styles.startText}>בנה מסלול ←</Text>
          </TouchableOpacity>
        )}

      </ScrollView>
    </View>
  );
}

function Section({ label, done, children }: { label: string; done: boolean; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.box}>
      <View style={sectionStyles.labelRow}>
        <Text style={sectionStyles.label}>{label}</Text>
        {done && <Text style={sectionStyles.check}>✓</Text>}
      </View>
      {children}
    </View>
  );
}

const NAVY  = theme.colors.primary;   // #0F2044
const GOLD  = theme.colors.gold;      // #C9A84C
const HORSE = '#A08050';              // shiny light brown, subtle

const sectionStyles = StyleSheet.create({
  box:      { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, elevation: 2, borderLeftWidth: 3, borderLeftColor: GOLD },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  label:    { fontSize: 13, fontWeight: '700', color: NAVY, letterSpacing: 1, textTransform: 'uppercase' },
  check:    { fontSize: 16, color: GOLD, fontWeight: '900' },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.cream },

  /* ── Header ── */
  header: {
    backgroundColor: NAVY,
    paddingTop: 48, paddingBottom: 20, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },

  /* Geo / city */
  geoBtnFull: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: NAVY, borderRadius: 10,
    paddingVertical: 14, marginBottom: 10,
  },
  geoIcon:    { fontSize: 20 },
  geoBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  orText:     { textAlign: 'center', color: '#9AA5B4', fontSize: 12, marginBottom: 10 },

  locationResult: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F4F6FA', borderRadius: 10, padding: 10,
    borderWidth: 1.5, borderColor: GOLD,
    alignSelf: 'flex-start', maxWidth: '100%',
  },
  locationPin:     { marginRight: 8 },
  locationPinIcon: { fontSize: 18 },
  locationText: {
    flexShrink: 1, fontSize: 14, fontWeight: '600',
    color: NAVY, textAlign: 'right', marginRight: 10,
  },
  changeBtn:     { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: NAVY, flexShrink: 0 },
  changeBtnText: { fontSize: 12, color: NAVY, fontWeight: '700' },

  /* Center crest */
  headerCenter: { flex: 1, alignItems: 'center' },
  crestOuter: {
    width: 68, height: 68, borderRadius: 34,
    borderWidth: 2, borderColor: GOLD,
    backgroundColor: 'rgba(201,168,76,0.12)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 4,
  },
  crestInner: {
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 1.5, borderColor: 'rgba(201,168,76,0.5)',
    justifyContent: 'center', alignItems: 'center',
  },
  crestLetter: { fontSize: 26, fontWeight: '900', color: GOLD },
  crestName:   { fontSize: 11, fontWeight: '700', color: GOLD, letterSpacing: 3, marginTop: 2 },
  crestSub:    { fontSize: 8, color: 'rgba(201,168,76,0.6)', letterSpacing: 1, marginTop: 1 },
  divider:     { width: 60, height: 1, backgroundColor: 'rgba(201,168,76,0.35)', marginVertical: 8 },
  appName:     { fontSize: 18, fontWeight: '900', color: '#fff', letterSpacing: 4 },
  appSub:      { fontSize: 9, color: 'rgba(255,255,255,0.45)', letterSpacing: 3, marginTop: 2 },

  goldLine: { height: 2, backgroundColor: GOLD },
  scroll:   { padding: 14 },

  /* Chips (managers, cities) */
  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip:         { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 18, borderWidth: 1.5, borderColor: NAVY, backgroundColor: '#fff' },
  chipActive:   { backgroundColor: NAVY },
  chipText:     { fontWeight: '700', fontSize: 12, color: NAVY },
  chipTextActive: { color: '#fff' },

  /* Agent chips */
  agentChip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 18, borderWidth: 1.5, borderColor: NAVY,
    backgroundColor: '#fff', minHeight: 40,
  },
  agentChipText: { fontWeight: '700', fontSize: 13, color: NAVY },

  /* City input */
  input: {
    borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 15, backgroundColor: '#fff',
    borderColor: NAVY, marginBottom: 0,
  },
  suggestions: { backgroundColor: '#fff', borderRadius: 8, elevation: 4, marginBottom: 8 },
  suggestion:  { padding: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  suggestionText: { fontSize: 14, textAlign: 'right', color: NAVY },

  /* Day row */
  dayRow:       { flexDirection: 'row', gap: 8 },
  dayBtn:       { flex: 1, height: 50, borderRadius: 8, borderWidth: 1.5, borderColor: NAVY, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  dayBtnActive: { backgroundColor: NAVY },
  dayLabel:     { fontSize: 22, fontWeight: '800', color: NAVY },
  dayLabelActive: { color: '#fff' },

  /* Start button */
  startBtn:  { backgroundColor: NAVY, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 6, marginBottom: 30, elevation: 3 },
  startText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 2 },
});
