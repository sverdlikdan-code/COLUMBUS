import React from 'react';
import { View, StyleSheet, Text, Platform } from 'react-native';
import { Client } from '../utils/nearestNeighbor';

interface Props {
  clients: Client[];
}

function buildHtml(clients: Client[]): string {
  const withGps = clients.filter(c => c.lat && c.lng);
  const markers = withGps.map((c, i) =>
    `L.marker([${c.lat},${c.lng}],{icon:makeIcon(${i+1})})` +
    `.bindPopup('<b>${i+1}. ${c.custName.replace(/'/g, "\\'")}</b><br/>${(c.city || '').replace(/'/g, "\\'")}').addTo(map);`
  ).join('\n');

  const center = withGps.length > 0
    ? `[${withGps[0].lat},${withGps[0].lng}]`
    : '[31.7,35.2]';

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  body,html{margin:0;padding:0;height:100%;}
  #map{width:100%;height:100vh;}
  .custom-pin{
    background:#0F2044;color:#C9A84C;border-radius:50%;
    width:22px;height:22px;display:flex;align-items:center;
    justify-content:center;font-size:10px;font-weight:800;
    border:2px solid #C9A84C;box-sizing:border-box;
  }
</style>
</head>
<body>
<div id="map"></div>
<script>
var map=L.map('map',{zoomControl:true});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  attribution:'© OSM',maxZoom:18
}).addTo(map);

function makeIcon(n){
  return L.divIcon({
    html:'<div class="custom-pin">'+n+'</div>',
    className:'',iconSize:[22,22],iconAnchor:[11,11],popupAnchor:[0,-12]
  });
}

${markers}

var pts=[${withGps.map(c => `[${c.lat},${c.lng}]`).join(',')}];
if(pts.length>1){map.fitBounds(pts,{padding:[16,16]});}
else if(pts.length===1){map.setView(pts[0],14);}
else{map.setView(${center},8);}
</script>
</body>
</html>`;
}

export default function MapLeaflet({ clients }: Props) {
  const noGps = clients.filter(c => !c.lat || !c.lng).length;

  if (Platform.OS === 'web') {
    const withGps = clients.filter(c => c.lat && c.lng);
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>🗺️ מפה — {withGps.length} לקוחות עם GPS</Text>
        {withGps.map((c, i) => (
          <Text key={c.custId} style={styles.fallbackRow}>
            {i + 1}. {c.custName} — {c.city || '—'}
          </Text>
        ))}
        {noGps > 0 && <Text style={styles.fallbackNew}>⚠️ {noGps} לקוחות ללא GPS (NEW)</Text>}
      </View>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebView } = require('react-native-webview');
  const html = buildHtml(clients);

  return (
    <View style={styles.container}>
      <WebView
        source={{ html }}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
      />
      {noGps > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>NEW ×{noGps}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  webview:   { flex: 1 },
  badge: {
    position: 'absolute', bottom: 8, left: 8,
    backgroundColor: '#E65100', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  fallback: { flex: 1, padding: 12, backgroundColor: '#F4F6FA' },
  fallbackTitle: { fontSize: 13, fontWeight: '700', color: '#0F2044', marginBottom: 8 },
  fallbackRow: { fontSize: 11, color: '#333', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: '#eee' },
  fallbackNew: { fontSize: 11, color: '#E65100', fontWeight: '700', marginTop: 8 },
});
