import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Client, isValidIsraelGps } from '../utils/nearestNeighbor';
import { removeCityFromName } from '../utils/nameUtils';

const DAY_LABELS: Record<number, string> = { 1:'א', 2:'ב', 3:'ג', 4:'ד', 5:'ה' };

interface Props {
  client: Client;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPress: () => void;
  onChangeDayPress: () => void;
  isSelected: boolean;
  drag: () => void;
  walkableWithNext?: boolean;
  walkableWithPrev?: boolean;
}

const NAVY = '#0F2044';
const GOLD = '#C9A84C';

const WALK_COLOR = '#2E7D32';

function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function formatSales(amount: number | undefined): string {
  if (!amount) return '';
  if (amount >= 1_000_000) return `₪${(amount / 1_000_000).toFixed(1)}m`;
  if (amount >= 1_000) return `₪${Math.round(amount / 1_000)}k`;
  return `₪${Math.round(amount)}`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export default function ClientCard({ client, index, total, onMoveUp, onMoveDown, onPress, onChangeDayPress, isSelected, drag, walkableWithNext, walkableWithPrev }: Props) {
  const hasNoGps = !isValidIsraelGps(client.lat, client.lng);
  const displayName = removeCityFromName(client.custName, client.city);
  const location = [client.city, client.address].filter(Boolean).join(' · ');
  const orderDays = daysSince(client.lastOrderDate);
  const orderAlert = orderDays !== null && orderDays > 13;
  const doneToday = orderDays === 0;
  const inWalkGroup = walkableWithNext || walkableWithPrev;

  const cardStyle = [
    styles.card,
    inWalkGroup && styles.walkCard,
    walkableWithNext && !walkableWithPrev && styles.walkTop,
    walkableWithPrev && !walkableWithNext && styles.walkBottom,
    walkableWithNext && walkableWithPrev && styles.walkMiddle,
    doneToday && styles.doneTodayCard,
    isSelected && styles.selected,
  ];

  return (
    <TouchableOpacity
      onLongPress={drag}
      onPress={onPress}
      style={cardStyle}
      activeOpacity={0.75}
    >
      {/* Drag handle */}
      <TouchableOpacity onLongPress={drag} style={styles.dragHandle}>
        <Text style={styles.dragIcon}>⠿</Text>
      </TouchableOpacity>

      {/* Order badge + walk icon */}
      <View style={styles.orderWrap}>
        <View style={[styles.orderBadge, inWalkGroup && styles.orderBadgeWalk]}>
          <Text style={styles.orderText}>{index + 1}</Text>
        </View>
        {inWalkGroup && (
          <Text style={styles.walkIconInline}>🚶</Text>
        )}
      </View>

      {/* Name + address stacked */}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          {hasNoGps && (
            <View style={styles.noGpsBadge}>
              <Text style={styles.noGpsText}>NEW</Text>
            </View>
          )}
          <Text style={[styles.name, hasNoGps && styles.nameNoGps]} numberOfLines={1}>{displayName}</Text>
        </View>
        <Text style={[styles.address, hasNoGps && styles.addressNoGps]} numberOfLines={1}>
          {location || (hasNoGps ? client.city || '—' : '')}
        </Text>
        {orderDays !== null && !doneToday && (
          <View style={[styles.orderDateRow, orderAlert && styles.orderDateAlert]}>
            <Text style={[styles.orderDateText, orderAlert && styles.orderDateTextAlert]}>
              {orderAlert ? `⚠ ${orderDays}d` : `✓ ${orderDays}d`}
            </Text>
          </View>
        )}
      </View>

      {/* Done-today checkmark */}
      {doneToday && (
        <View style={styles.doneTodayBadge}>
          <Text style={styles.doneTodayCheck}>✅</Text>
          <Text style={styles.doneTodayLabel}>היום</Text>
        </View>
      )}

      {/* Day button — right side, separate from arrows */}
      <TouchableOpacity onPress={onChangeDayPress} style={styles.dayBtn}>
        <Text style={styles.dayBtnText}>{DAY_LABELS[client.dayNum] ?? '—'}</Text>
      </TouchableOpacity>

      {/* ↑↓ arrows */}
      <View style={styles.arrows}>
        <TouchableOpacity onPress={onMoveUp} disabled={index === 0} style={styles.arrowBtn}>
          <Text style={[styles.arrowText, index === 0 && styles.arrowDisabled]}>▲</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onMoveDown} disabled={index === total - 1} style={styles.arrowBtn}>
          <Text style={[styles.arrowText, index === total - 1 && styles.arrowDisabled]}>▼</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 7,
    marginVertical: 1,
    marginHorizontal: 5,
    paddingVertical: 4,
    paddingHorizontal: 7,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 1,
  },
  selected: {
    borderWidth: 1.5,
    borderColor: GOLD,
    backgroundColor: 'rgba(201,168,76,0.06)',
  },
  dragHandle: {
    width: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 3,
  },
  dragIcon: { fontSize: 12, color: '#C4CDD6' },
  orderWrap: {
    alignItems: 'center',
    marginRight: 8,
    flexShrink: 0,
  },
  orderBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: NAVY,
    justifyContent: 'center',
    alignItems: 'center',
  },
  walkIconInline: {
    fontSize: 10,
    marginTop: 1,
  },
  orderText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  info: { flex: 1, flexDirection: 'column', justifyContent: 'center' },
  flex1: { flex: 1 },
  address: {
    fontSize: 10,
    color: '#9AA5B4',
    textAlign: 'right',
    marginTop: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  name: {
    fontSize: 13,
    fontWeight: '600',
    color: NAVY,
    textAlign: 'right',
    flexShrink: 1,
  },
  noGpsBadge: {
    backgroundColor: '#E65100',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  noGpsText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  nameNoGps: { color: '#E65100', fontWeight: '800' },
  addressNoGps: { color: '#E65100', fontSize: 11, opacity: 0.8 },
  dayBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: NAVY,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
    marginRight: 4,
  },
  dayBtnText: { fontSize: 12, fontWeight: '900', color: GOLD },
  arrows: { flexDirection: 'column', gap: 1 },
  arrowBtn: {
    width: 24,
    height: 24,
    borderRadius: 5,
    backgroundColor: 'rgba(15,32,68,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrowText: { fontSize: 10, color: NAVY },
  arrowDisabled: { color: '#C4CDD6' },

  // Walkable group styles
  walkCard: {
    backgroundColor: 'rgba(46,125,50,0.05)',
    borderLeftWidth: 3,
    borderLeftColor: WALK_COLOR,
  },
  walkTop: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    marginBottom: 0,
  },
  walkBottom: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    marginTop: 0,
  },
  walkMiddle: {
    borderRadius: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  orderBadgeWalk: {
    backgroundColor: WALK_COLOR,
  },
  walkBadge: {
    position: 'absolute',
    top: -6,
    right: 60,
    backgroundColor: WALK_COLOR,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  walkIcon: { fontSize: 12 },
  orderDateRow: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(46,125,50,0.1)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginTop: 2,
  },
  orderDateAlert: {
    backgroundColor: 'rgba(230,81,0,0.12)',
  },
  doneTodayCard: {
    backgroundColor: 'rgba(27,94,32,0.07)',
    borderLeftWidth: 3,
    borderLeftColor: '#1B5E20',
  },
  doneTodayBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
    minWidth: 34,
  },
  doneTodayCheck: {
    fontSize: 22,
  },
  doneTodayLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#1B5E20',
    marginTop: -2,
  },
  orderDateText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#2E7D32',
  },
  orderDateTextAlert: {
    color: '#E65100',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 3,
    marginTop: 2,
    justifyContent: 'flex-end',
  },
  salesBadge: {
    backgroundColor: 'rgba(15,32,68,0.08)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  salesText: {
    fontSize: 9,
    fontWeight: '700',
    color: NAVY,
  },
  dateBadge: {
    backgroundColor: 'rgba(15,32,68,0.06)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  dateText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#9AA5B4',
  },
});
