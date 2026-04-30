import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Client } from '../utils/nearestNeighbor';

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
}

const NAVY = '#0F2044';
const GOLD = '#C9A84C';

export default function ClientCard({ client, index, total, onMoveUp, onMoveDown, onPress, onChangeDayPress, isSelected, drag }: Props) {
  const hasNoGps = !client.lat || !client.lng;
  const location = [client.city, client.address].filter(Boolean).join(' · ');

  return (
    <TouchableOpacity
      onLongPress={drag}
      onPress={onPress}
      style={[styles.card, isSelected && styles.selected]}
      activeOpacity={0.75}
    >
      {/* Drag handle */}
      <TouchableOpacity onLongPress={drag} style={styles.dragHandle}>
        <Text style={styles.dragIcon}>⠿</Text>
      </TouchableOpacity>

      {/* Order badge */}
      <View style={styles.orderBadge}>
        <Text style={styles.orderText}>{index + 1}</Text>
      </View>

      {/* Address (left) + Name (right) in one row */}
      <View style={styles.info}>
        {location ? (
          <Text style={styles.address} numberOfLines={1}>{location}</Text>
        ) : (
          <View style={styles.flex1} />
        )}
        <View style={styles.nameRow}>
          {hasNoGps && (
            <View style={styles.noGpsBadge}>
              <Text style={styles.noGpsText}>NEW</Text>
            </View>
          )}
          <Text style={styles.name} numberOfLines={1}>{client.custName}</Text>
        </View>
      </View>

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
  orderBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: NAVY,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    flexShrink: 0,
  },
  orderText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  info: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex1: { flex: 1 },
  address: {
    flex: 1,
    fontSize: 10,
    color: '#9AA5B4',
    textAlign: 'left',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
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
});
