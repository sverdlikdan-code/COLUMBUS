import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal, useWindowDimensions
} from 'react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Client, nearestNeighborSort } from '../utils/nearestNeighbor';
import { totalRouteKm, haversineMeters } from '../utils/haversine';
import { fetchCustomers } from '../api/client';
import { exportToExcel } from '../utils/exportExcel';
import KmPanel from '../components/KmPanel';
import ClientCard from '../components/ClientCard';
import MapLeaflet from '../components/MapLeaflet';
import { theme } from '../theme';

const DAY_LABELS: Record<number, string> = { 1:'א', 2:'ב', 3:'ג', 4:'ד', 5:'ה' };

interface Props {
  agentCode: string;
  agentName: string;
  managerName: string;
  startCity: string;
  selectedDay: number;
  onBack: () => void;
}

type Tab = 'list' | 'map';

export default function RouteScreen({ agentCode, agentName, managerName, startCity, selectedDay, onBack }: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [currentDay, setCurrentDay] = useState(selectedDay);
  const [clients, setClients] = useState<Client[]>([]);
  const [originalClients, setOriginalClients] = useState<Client[]>([]);
  const [aiClients, setAiClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [priorityKm, setPriorityKm] = useState<number | null>(null);
  const [aiKm, setAiKm] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('list');
  const [sortMode, setSortMode] = useState<'priority' | 'ai'>('priority');
  const [isDemo, setIsDemo] = useState(false);
  const [dayPickerClient, setDayPickerClient] = useState<string | null>(null);

  const displayClients = sortMode === 'ai' ? aiClients : clients;

  const firstDivergingId = useMemo(() => {
    for (let i = 0; i < Math.min(clients.length, aiClients.length); i++) {
      if (clients[i].custId !== aiClients[i].custId) return clients[i].custId;
    }
    return null;
  }, [clients, aiClients]);

  useEffect(() => { loadData(); }, [currentDay]);

  async function loadData() {
    setLoading(true);
    try {
      const data: Client[] = await fetchCustomers(agentCode, currentDay);
      const sorted = [...data].sort((a, b) => (a.priorityOrder || 0) - (b.priorityOrder || 0));
      setClients(sorted);
      setOriginalClients(sorted.map(c => ({ ...c })));
      setAiClients(nearestNeighborSort(data));
    } catch (e: any) {
      const demo = DEMO_CLIENTS.map(c => ({ ...c, agentCode, agentName, dayNum: selectedDay }));
      setClients(demo);
      setOriginalClients(demo.map(c => ({ ...c })));
      setAiClients(nearestNeighborSort(demo));
      setIsDemo(true);
    } finally {
      setLoading(false);
    }
  }

  function hasChanges(): boolean {
    if (clients.length !== originalClients.length) return true;
    return clients.some((c, i) => {
      const orig = originalClients.find(o => o.custId === c.custId);
      return !orig || originalClients.indexOf(orig) !== i || orig.dayNum !== c.dayNum;
    });
  }

  async function doExport() {
    await exportToExcel({ clients, agentName, managerName, originalClients });
  }

  function handleBack() {
    if (!hasChanges()) { onBack(); return; }
    Alert.alert(
      'יש שינויים',
      'בוצעו שינויים במסלול. מה לעשות לפני היציאה?',
      [
        { text: 'ביטול', style: 'cancel' },
        { text: 'יציאה ללא שמירה', style: 'destructive', onPress: onBack },
        { text: '📊 שמור וייצא Excel', onPress: async () => { await doExport(); onBack(); } },
      ],
      { cancelable: true }
    );
  }

  useEffect(() => {
    if (clients.length > 0) setPriorityKm(totalRouteKm(clients));
  }, [clients]);

  useEffect(() => {
    if (aiClients.length > 0) setAiKm(totalRouteKm(aiClients));
  }, [aiClients]);

  function changeClientDay(custId: string, newDay: number) {
    setClients(prev => prev.map(c => c.custId === custId ? { ...c, dayNum: newDay } : c));
    setDayPickerClient(null);
  }

  function moveClient(index: number, dir: 'up' | 'down') {
    const list = [...clients];
    const to = dir === 'up' ? index - 1 : index + 1;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    setClients(list);
  }

  const renderItem = useCallback(({ item, getIndex, drag }: RenderItemParams<Client>) => {
    const index = getIndex() ?? 0;
    const prev = index > 0 ? displayClients[index - 1] : null;
    const next = index < displayClients.length - 1 ? displayClients[index + 1] : null;
    const walkableWithPrev = !!(prev && prev.lat && prev.lng && item.lat && item.lng &&
      haversineMeters(prev.lat, prev.lng, item.lat, item.lng) <= 400);
    const walkableWithNext = !!(next && next.lat && next.lng && item.lat && item.lng &&
      haversineMeters(item.lat, item.lng, next.lat, next.lng) <= 200);
    return (
      <ClientCard
        client={item} index={index} total={displayClients.length}
        onMoveUp={() => moveClient(index, 'up')}
        onMoveDown={() => moveClient(index, 'down')}
        onPress={() => setSelectedId(item.custId === selectedId ? null : item.custId)}
        onChangeDayPress={() => setDayPickerClient(item.custId)}
        isSelected={item.custId === selectedId}
        drag={drag}
        walkableWithPrev={walkableWithPrev}
        walkableWithNext={walkableWithNext}
      />
    );
  }, [displayClients, selectedId, sortMode]);

  const selected = displayClients.find(c => c.custId === selectedId);

  return (
    <GestureHandlerRootView style={styles.root}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.agentName}>{agentName}</Text>
          <Text style={styles.headerSub}>{clients.length > 0 ? `${clients.length} לקוחות` : ''}</Text>
        </View>
      </View>

      {/* Day selector row */}
      <View style={styles.dayRow}>
        {[1,2,3,4,5].map(d => (
          <TouchableOpacity
            key={d}
            style={[styles.dayBtn, currentDay === d && styles.dayBtnActive]}
            onPress={() => { setCurrentDay(d); setSelectedId(null); }}
          >
            <Text style={[styles.dayBtnText, currentDay === d && styles.dayBtnTextActive]}>
              {DAY_LABELS[d]}
            </Text>
          </TouchableOpacity>
        ))}
        {startCity ? (
          <View style={styles.cityBtn}>
            <Text style={styles.cityBtnText} numberOfLines={1}>{startCity}</Text>
          </View>
        ) : null}
      </View>

      {/* KM panel horizontal full width */}
      <KmPanel priorityKm={priorityKm} aiKm={aiKm} onExport={doExport} />

      {/* Demo mode banner */}
      {isDemo && (
        <View style={styles.demoBanner}>
          <Text style={styles.demoText}>⚠️ מצב הדגמה — אין חיבור לשרת. הנתונים הם לדוגמה בלבד</Text>
        </View>
      )}


      {/* Tab bar — only on narrow screens */}
      {!isWide && (
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, tab === 'list' && styles.tabActive]}
            onPress={() => setTab('list')}
          >
            <Text style={[styles.tabText, tab === 'list' && styles.tabTextActive]}>📋 רשימה</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'map' && styles.tabActive]}
            onPress={() => setTab('map')}
          >
            <Text style={[styles.tabText, tab === 'map' && styles.tabTextActive]}>🗺️ מפה</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <View style={styles.bodyOuter}>

          {/* Main content area */}
          <View style={styles.bodyMain}>
            {isWide ? (
              /* WIDE LAYOUT — list left, map right */
              <View style={styles.wideLayout}>
                <View style={styles.wideList}>
                  <SortToggle sortMode={sortMode} onToggle={() => setSortMode(m => m === 'priority' ? 'ai' : 'priority')} />
                  <View style={styles.body}>
                    <View style={[styles.listCol, !selected && styles.listColFull]}>
                      <DraggableFlatList
                        data={displayClients}
                        keyExtractor={item => item.custId}
                        renderItem={renderItem}
                        onDragEnd={({ data }) => {
                          if (sortMode === 'priority') { setClients(data); }
                        }}
                      />
                    </View>
                    {selected && (() => {
                      const pIdx = clients.findIndex(c => c.custId === selected.custId) + 1;
                      const aIdx = aiClients.findIndex(c => c.custId === selected.custId) + 1;
                      const canShorten = selected.custId === firstDivergingId;
                      return (
                        <View style={styles.panel}>
                          <TouchableOpacity style={styles.panelClose} onPress={() => setSelectedId(null)}>
                            <Text style={styles.panelCloseText}>✕</Text>
                          </TouchableOpacity>
                          {canShorten && (
                            <View style={styles.shortenBadge}>
                              <Text style={styles.shortenIcon}>↻</Text>
                              <Text style={styles.shortenText}>אדיף שינוי מסלול</Text>
                            </View>
                          )}
                          <Text style={styles.panelTitle}>{selected.custName}</Text>
                          <PanelRow label="סדר ביקור" value={`#${pIdx}`} />
                          <PanelRow label="סדר AI"     value={`#${aIdx}`} />
                          <PanelRow label="כתובת"      value={selected.fullAddress} />
                          <PanelRow label="עיר"        value={selected.city} />
                          <PanelRow label="מס. לקוח"   value={selected.custId} />
                          <PanelRow label="סטטוס"      value={selected.status} />
                          <PanelRow label="כשרות"      value={selected.kosher} />
                          <PanelRow
                            label="GPS"
                            value={selected.lat && selected.lng
                              ? `${selected.lat?.toFixed(5)}, ${selected.lng?.toFixed(5)}`
                              : 'אין קואורדינטות'}
                          />
                        </View>
                      );
                    })()}
                  </View>
                </View>
                <View style={styles.wideMap}>
                  <MapLeaflet clients={displayClients} />
                </View>
              </View>
            ) : tab === 'list' ? (
              /* NARROW — LIST VIEW */
              <View style={styles.narrowList}>
                <SortToggle sortMode={sortMode} onToggle={() => setSortMode(m => m === 'priority' ? 'ai' : 'priority')} />
              <View style={styles.body}>
                <View style={[styles.listCol, !selected && styles.listColFull]}>
                  <DraggableFlatList
                    data={displayClients}
                    keyExtractor={item => item.custId}
                    renderItem={renderItem}
                    onDragEnd={({ data }) => {
                      if (sortMode === 'priority') { setClients(data); }
                    }}
                  />
                </View>
                {selected && (
                  <View style={styles.panel}>
                    <TouchableOpacity style={styles.panelClose} onPress={() => setSelectedId(null)}>
                      <Text style={styles.panelCloseText}>✕</Text>
                    </TouchableOpacity>
                    <Text style={styles.panelTitle}>{selected.custName}</Text>
                    <PanelRow label="כתובת"    value={selected.fullAddress} />
                    <PanelRow label="עיר"      value={selected.city} />
                    <PanelRow label="מס. לקוח" value={selected.custId} />
                    <PanelRow label="סטטוס"    value={selected.status} />
                    <PanelRow label="כשרות"    value={selected.kosher} />
                    <PanelRow
                      label="GPS"
                      value={selected.lat && selected.lng
                        ? `${selected.lat?.toFixed(5)}, ${selected.lng?.toFixed(5)}`
                        : 'אין קואורדינטות'}
                    />
                  </View>
                )}
              </View>
              </View>
            ) : (
              /* NARROW — MAP VIEW */
              <MapLeaflet clients={displayClients} />
            )}
          </View>


        </View>
      )}
      {/* Day picker modal */}
      <Modal
        visible={!!dayPickerClient}
        transparent
        animationType="fade"
        onRequestClose={() => setDayPickerClient(null)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDayPickerClient(null)}>
          <View style={styles.dayPickerBox}>
            <Text style={styles.dayPickerTitle}>שנה יום ביקור</Text>
            <View style={styles.dayPickerRow}>
              {[1,2,3,4,5].map(d => (
                <TouchableOpacity
                  key={d}
                  style={[styles.dayPickerBtn, clients.find(c => c.custId === dayPickerClient)?.dayNum === d && styles.dayPickerBtnActive]}
                  onPress={() => dayPickerClient && changeClientDay(dayPickerClient, d)}
                >
                  <Text style={[styles.dayPickerLetter, clients.find(c => c.custId === dayPickerClient)?.dayNum === d && styles.dayPickerLetterActive]}>
                    {DAY_LABELS[d]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

    </GestureHandlerRootView>
  );
}


function SortToggle({ sortMode, onToggle }: { sortMode: 'priority' | 'ai'; onToggle: () => void }) {
  return (
    <View style={toggleStyles.wrap}>
      <TouchableOpacity
        style={[toggleStyles.btn, sortMode !== 'ai' && toggleStyles.btnActive]}
        onPress={() => sortMode === 'ai' && onToggle()}
      >
        <Text style={[toggleStyles.text, sortMode !== 'ai' && toggleStyles.textActive]}>סדר ביקור</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[toggleStyles.btn, sortMode === 'ai' && toggleStyles.btnActiveAi]}
        onPress={() => sortMode !== 'ai' && onToggle()}
      >
        <Text style={[toggleStyles.text, sortMode === 'ai' && toggleStyles.textActive]}>AI סדר</Text>
      </TouchableOpacity>
    </View>
  );
}

function PanelRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={rowStyles.value}>{value || '—'}</Text>
    </View>
  );
}

// Demo clients — shown when server unreachable (e.g. outside office LAN or web preview)
const DEMO_CLIENTS: Client[] = [
  { custId: 'D01', custName: 'סופר מרכז ירושלים',   city: 'ירושלים', address: 'רחוב יפו 10',        fullAddress: 'רחוב יפו 10, ירושלים',          lat: 31.7767, lng: 35.2345, status: 'פעיל', kosher: 'חלב',  agentCode: '', agentName: '', priorityOrder: 1,  param7: '', dayNum: 1, dayLabel: 'א' },
  { custId: 'D02', custName: 'מכולת הצפון',          city: 'חיפה',    address: 'שדרות הנשיא 5',      fullAddress: 'שדרות הנשיא 5, חיפה',            lat: 32.7940, lng: 34.9896, status: 'פעיל', kosher: 'כשר',  agentCode: '', agentName: '', priorityOrder: 2,  param7: '', dayNum: 1, dayLabel: 'א' },
  { custId: 'D03', custName: 'שוק הכרמל',            city: 'תל אביב', address: 'רחוב הכרמל 3',       fullAddress: 'רחוב הכרמל 3, תל אביב',          lat: 32.0617, lng: 34.7753, status: 'פעיל', kosher: '',     agentCode: '', agentName: '', priorityOrder: 3,  param7: '', dayNum: 1, dayLabel: 'א' },
  { custId: 'D04', custName: 'סופרמרקט רמת גן',      city: 'רמת גן',  address: 'ביאליק 20',           fullAddress: 'ביאליק 20, רמת גן',              lat: 32.0695, lng: 34.8237, status: 'פעיל', kosher: 'חלב',  agentCode: '', agentName: '', priorityOrder: 4,  param7: '', dayNum: 1, dayLabel: 'א' },
  { custId: 'D05', custName: 'מינימרקט פתח תקוה',    city: 'פ"ת',     address: 'ז\'בוטינסקי 45',      fullAddress: 'ז\'בוטינסקי 45, פתח תקוה',        lat: 32.0840, lng: 34.8818, status: 'פעיל', kosher: 'כשר',  agentCode: '', agentName: '', priorityOrder: 5,  param7: '', dayNum: 1, dayLabel: 'א' },
  { custId: 'D06', custName: 'חנות מזון ראשל"צ',     city: 'ראשל"צ',  address: 'הרצל 12',             fullAddress: 'הרצל 12, ראשון לציון',           lat: 31.9730, lng: 34.8066, status: 'פעיל', kosher: '',     agentCode: '', agentName: '', priorityOrder: 6,  param7: '', dayNum: 1, dayLabel: 'א' },
  { custId: 'D07', custName: 'סופרמרקט באר שבע',     city: 'ב"ש',     address: 'קק"ל 1',              fullAddress: 'קק"ל 1, באר שבע',                lat: 31.2518, lng: 34.7913, status: 'פעיל', kosher: 'חלב',  agentCode: '', agentName: '', priorityOrder: 7,  param7: '', dayNum: 1, dayLabel: 'א' },
  { custId: 'D08', custName: 'קואופ אשדוד',           city: 'אשדוד',   address: 'המלאכה 8',            fullAddress: 'המלאכה 8, אשדוד',                lat: 31.8044, lng: 34.6553, status: 'פעיל', kosher: 'כשר',  agentCode: '', agentName: '', priorityOrder: 8,  param7: '', dayNum: 1, dayLabel: 'א' },
  { custId: 'D09', custName: 'שופרסל נהריה',          city: 'נהריה',   address: 'הגעתון 22',           fullAddress: 'הגעתון 22, נהריה',               lat: 33.0080, lng: 35.0985, status: 'פעיל', kosher: '',     agentCode: '', agentName: '', priorityOrder: 9,  param7: '', dayNum: 1, dayLabel: 'א' },
  { custId: 'D10', custName: 'מכולת נצרת',            city: 'נצרת',    address: 'רחוב הגליל 5',        fullAddress: 'רחוב הגליל 5, נצרת',             lat: 32.6996, lng: 35.3035, status: 'פעיל', kosher: 'חלב',  agentCode: '', agentName: '', priorityOrder: 10, param7: '', dayNum: 1, dayLabel: 'א' },
  { custId: 'D11', custName: 'פרש מרקט הרצליה',      city: 'הרצליה',  address: 'סוקולוב 30',          fullAddress: 'סוקולוב 30, הרצליה',             lat: 32.1664, lng: 34.8438, status: 'פעיל', kosher: '',     agentCode: '', agentName: '', priorityOrder: 11, param7: '', dayNum: 1, dayLabel: 'א' },
  { custId: 'D12', custName: 'חנות חדשה ללא GPS',    city: 'נתניה',   address: '',                    fullAddress: 'נתניה',                           lat: 0,       lng: 0,       status: 'פעיל', kosher: '',     agentCode: '', agentName: '', priorityOrder: 0,  param7: '', dayNum: 1, dayLabel: 'א' },
];

const toggleStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    marginHorizontal: 6,
    marginVertical: 5,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#0F2044',
  },
  btn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  btnActive:   { backgroundColor: '#0F2044' },
  btnActiveAi: { backgroundColor: '#C9A84C' },
  text:        { fontSize: 12, fontWeight: '800', color: '#0F2044' },
  textActive:  { color: '#fff' },
});

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  label: { fontSize: 12, color: '#999', flex: 1 },
  value: { fontSize: 13, color: '#222', flex: 2, textAlign: 'right' },
});

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: theme.colors.cream },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: theme.colors.primary,
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 28, paddingBottom: 10, paddingHorizontal: 14,
  },
  backBtn:  { padding: 4, marginRight: 8 },
  backText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  headerInfo: { flex: 1 },
  agentName: { color: '#fff', fontSize: 15, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 1 },
  dayRow: {
    flexDirection: 'row', backgroundColor: '#0F2044',
    paddingHorizontal: 8, paddingBottom: 6, paddingTop: 4, gap: 5,
    alignItems: 'center',
  },
  dayBtn: {
    flex: 1, height: 26, borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  dayBtnActive: { backgroundColor: theme.colors.gold },
  dayBtnText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '900' },
  dayBtnTextActive: { color: '#0F2044' },
  cityBtn: {
    height: 26, borderRadius: 6, paddingHorizontal: 8,
    backgroundColor: 'rgba(201,168,76,0.18)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.4)',
    maxWidth: 90,
  },
  cityBtnText: { color: '#C9A84C', fontSize: 11, fontWeight: '700' },
  goldLine:  { height: 3, backgroundColor: theme.colors.gold },
  clientCount: { flex: 1, textAlign: 'right', fontSize: 13, color: '#999', paddingRight: 4 },
  tabBar:    { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#ddd' },
  tab:       { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: theme.colors.primary },
  tabText:   { fontSize: 14, color: '#999', fontWeight: '600' },
  tabTextActive: { color: theme.colors.primary },
  bodyOuter:    { flex: 1 },
  bodyMain:     { flex: 1 },
  wideLayout:   { flex: 1, flexDirection: 'row' },
  wideList:     { width: 420, borderRightWidth: 1, borderRightColor: '#E8EDF2', flexDirection: 'column' },
  wideMap:      { flex: 1 },
  narrowList:   { flex: 1, flexDirection: 'column' },
  body:         { flex: 1, flexDirection: 'row' },
  listCol:      { flex: 3 },
  listColFull:  { flex: 1 },
  panel: { flex: 2, backgroundColor: '#fff', margin: 6, borderRadius: 12, padding: 14, elevation: 3 },
  panelClose: { position: 'absolute', top: 10, left: 12, zIndex: 1, padding: 4 },
  panelCloseText: { fontSize: 14, color: '#9AA5B4', fontWeight: '700' },
  panelTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.primary, textAlign: 'right', marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 8, paddingTop: 4 },
  mapContainer: { flex: 1 },
  mapContent: { padding: 16 },
  // Day picker modal
  modalOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  dayPickerBox:     { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: 280, elevation: 8 },
  dayPickerTitle:   { fontSize: 15, fontWeight: '800', color: theme.colors.primary, textAlign: 'center', marginBottom: 18 },
  dayPickerRow:     { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  dayPickerBtn:     { flex: 1, height: 52, borderRadius: 10, borderWidth: 2, borderColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  dayPickerBtnActive: { backgroundColor: theme.colors.primary },
  dayPickerLetter:  { fontSize: 24, fontWeight: '900', color: theme.colors.primary },
  dayPickerLetterActive: { color: '#fff' },

  // Demo banner
  demoBanner: { backgroundColor: '#FFF3E0', paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#FFB74D' },
  demoText: { fontSize: 11, color: '#E65100', textAlign: 'center', fontWeight: '600' },

  // Shorten badge
  shortenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 5,
    backgroundColor: 'rgba(201,168,76,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.4)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  shortenIcon: { fontSize: 13, color: '#C9A84C' },
  shortenText: { fontSize: 11, fontWeight: '700', color: '#C9A84C' },
});
