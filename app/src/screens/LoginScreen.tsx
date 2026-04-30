import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { fetchManagers, fetchManagerAgents } from '../api/client';
import { theme } from '../theme';

interface ManagerAgent { agentCode: string; agentName: string; }
interface Manager { managerCode: string; }

const DEMO_MANAGERS = ['VLAD', 'ALEXEY', 'NATALYA', 'SVETA', 'ANATOL', 'SADRAN+'];

const DEMO_AGENTS: Record<string, ManagerAgent[]> = {
  ANATOL:    [{ agentCode: '238', agentName: 'וצ\'סלב שולקין' }, { agentCode: '112', agentName: 'סרגיי שפונט' }, { agentCode: '123', agentName: 'קונסטנטין קפוסטינסקי' }, { agentCode: '131', agentName: 'אלברט מרדכייב' }, { agentCode: '201', agentName: 'דמיטרי וקס' }],
  ALEXEY:    [{ agentCode: '110', agentName: 'אולג גלדקיך' }, { agentCode: '258', agentName: 'דוד גומרשטדט' }, { agentCode: '149', agentName: 'יבגני אפנסייב' }],
  NATALYA:   [{ agentCode: '129', agentName: 'אלכסיי סביצקי' }, { agentCode: '136', agentName: 'דמיטרי שפילמן' }, { agentCode: '239', agentName: 'דן אוחיון' }, { agentCode: '114', agentName: 'רוסלן שפילמן' }],
  SVETA:     [{ agentCode: '260', agentName: 'אדלינה גולדפאיין' }, { agentCode: '126', agentName: 'אולג בלז\'' }, { agentCode: '215', agentName: 'אלכסנדר סוסנוב' }, { agentCode: '257', agentName: 'זויה ציגנקוב' }],
  VLAD:      [{ agentCode: '62', agentName: 'אוריאל חיימצ\'אייב' }, { agentCode: '138', agentName: 'טוליק בסרייב' }, { agentCode: '275', agentName: 'עירית בלובה' }, { agentCode: '250', agentName: 'מקסים קרילוב' }, { agentCode: '234', agentName: 'מרגריטה מאקארצ\'בה' }],
  'SADRAN+': [{ agentCode: '272', agentName: 'אלכס שלפקוב' }, { agentCode: '235', agentName: 'אלכסיי נובוסלסקי' }, { agentCode: '256', agentName: 'יבגני בלקיטני' }, { agentCode: '225', agentName: 'יבגני זמשה' }, { agentCode: '254', agentName: 'יגאל רייכמן' }, { agentCode: '59', agentName: 'רומן איגנטייב' }],
};

interface Props {
  onSelect: (code: string, name: string) => void;
}

export default function LoginScreen({ onSelect }: Props) {
  const [step, setStep] = useState<'manager' | 'agent'>('manager');
  const [managers, setManagers] = useState<string[]>([]);
  const [selectedManager, setSelectedManager] = useState<string | null>(null);
  const [agents, setAgents] = useState<ManagerAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    fetchManagers()
      .then((data: Manager[]) => {
        const list = data.map(m => m.managerCode).filter(Boolean);
        setManagers(list.length > 0 ? list : DEMO_MANAGERS);
        setIsDemo(list.length === 0);
      })
      .catch(() => { setManagers(DEMO_MANAGERS); setIsDemo(true); })
      .finally(() => setLoading(false));
  }, []);

  async function selectManager(mgr: string) {
    setSelectedManager(mgr);
    setStep('agent');
    setLoading(true);
    try {
      const data: ManagerAgent[] = await fetchManagerAgents(mgr);
      setAgents(data.length > 0 ? data : (DEMO_AGENTS[mgr] ?? []));
    } catch {
      setAgents(DEMO_AGENTS[mgr] ?? []);
    } finally {
      setLoading(false);
    }
  }

  const mgrColor = selectedManager
    ? (theme.managers[selectedManager as keyof typeof theme.managers] ?? theme.colors.primary)
    : theme.colors.primary;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: step === 'agent' ? mgrColor : theme.colors.primary }]}>
        {step === 'agent' && (
          <TouchableOpacity onPress={() => setStep('manager')} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
        )}

        <View style={styles.headerCenter}>
          <Text style={styles.appName}>DILLER FORMULA</Text>
          <Text style={styles.subtitle}>
            {step === 'manager' ? 'בחר מנהל' : `${selectedManager} — בחר סוכן`}
          </Text>

        </View>

        {isDemo && <Text style={styles.demoTag}>DEMO</Text>}
      </View>

      {/* Gold separator line */}
      <View style={styles.goldLine} />

      {/* Grid */}
      <ScrollView contentContainerStyle={styles.grid} style={{ backgroundColor: theme.colors.cream }}>
        {step === 'manager' && DEMO_MANAGERS.map(mgr => {
          const color = theme.managers[mgr as keyof typeof theme.managers] ?? theme.colors.primary;
          return (
            <TouchableOpacity
              key={mgr}
              style={[styles.card, { borderTopColor: color, borderTopWidth: 4 }]}
              onPress={() => selectManager(mgr)}
            >
              <View style={[styles.avatar, { backgroundColor: color }]}>
                <Text style={styles.avatarText}>{mgr.charAt(0)}</Text>
              </View>
              <Text style={styles.cardName}>{mgr}</Text>
            </TouchableOpacity>
          );
        })}

        {step === 'agent' && agents.map(a => (
          <TouchableOpacity
            key={a.agentCode}
            style={[styles.card, { borderTopColor: mgrColor, borderTopWidth: 4 }]}
            onPress={() => onSelect(a.agentCode, a.agentName)}
          >
            <View style={[styles.avatar, { backgroundColor: mgrColor }]}>
              <Text style={styles.avatarText}>{a.agentName.charAt(0)}</Text>
            </View>
            <Text style={styles.cardName}>{a.agentName}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: theme.colors.cream },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.cream },
  header: {
    paddingTop: 40, paddingBottom: 20, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'flex-start',
  },
  backBtn:      { padding: 4, marginRight: 8, marginTop: 4 },
  backText:     { color: '#fff', fontSize: 24, fontWeight: '700' },
  headerCenter: { flex: 1, alignItems: 'center' },
  appName: {
    fontSize: 30, fontWeight: '800', color: '#fff',
    letterSpacing: 5,
  },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4 },
  demoTag: {
    fontSize: 9, color: theme.colors.gold,
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10, letterSpacing: 1, marginTop: 6,
  },
  goldLine: { height: 3, backgroundColor: theme.colors.gold },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    padding: 20, gap: 14, justifyContent: 'center',
  },
  card: {
    width: 150, height: 110,
    backgroundColor: theme.colors.white,
    borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    elevation: 3,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8,
    gap: 8,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 22, fontWeight: '800', color: '#fff' },
  cardName: {
    fontSize: 12, fontWeight: '700', color: theme.colors.textDark,
    textAlign: 'center', paddingHorizontal: 8,
  },
});
