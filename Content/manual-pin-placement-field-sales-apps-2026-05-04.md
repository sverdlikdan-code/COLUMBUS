---
source: multiple (WebSearch aggregation)
retrieved: 2026-05-04
language: en
original_title: Manual Pin Placement / GPS Correction in Field Sales & Service Apps
---

# Manual Pin Placement / GPS Correction in Field Sales Apps

> Source: WebSearch aggregation — 2026-05-04

## Summary

Field sales apps handle wrong/missing customer GPS coordinates via a "tap-to-place" or "manual pin" feature. The user opens the client record, switches to a map view, taps the correct location, optionally drags the pin to fine-tune, then confirms. The corrected coordinates are saved to the record and queued for server sync. The feature exists across multiple platforms under slightly different names. React Native implementation is straightforward via `react-native-maps` `onPress` + draggable `Marker`.

## Apps with This Feature and What They Call It

| App | Feature Name | Notes |
|---|---|---|
| **Badger Maps** | "Check In / Pin Location" | Freehand lasso + pin tools; reps can place and update account locations on the map |
| **SPOTIO** | "GPS Tagging" | One-tap GPS tag on a customer record; integrates with lead forms |
| **Salesforce Maps** | "Pin / Account Location" | Plot accounts on a visual map; supports manual override of coordinates |
| **BeatRoute** | "Outlet Geotagging" / "Beat Location" | Explicit geotag step when creating or editing an outlet; offline-capable |
| **PepUpSales** | "Outlet Location Tagging" | Part of the outlet creation flow; agent places pin, coordinates stored against the outlet |
| **ArcGIS Field Maps** | "Collect / Update Feature Location" | Full tap-to-place with GPS averaging; used in field data collection contexts |
| **Dynamics 365 Field Service** | "Customer Location" | Technician can correct address pin from mobile; syncs to CRM |

Note: Bringg and RouteOptima are logistics/delivery platforms — their location correction is typically handled by dispatcher, not the field agent.

## Best UX Pattern (Industry Standard)

1. Agent opens a client card -> taps "Fix Location" or map icon
2. Map opens centered on current (possibly wrong) coordinates, or on agent's GPS if no coords exist
3. A crosshair or draggable pin sits at center — agent drags map under it, OR taps to drop pin
4. Optional: "Use my current location" button as shortcut
5. Confirm dialog: shows lat/lng or street address (reverse geocoded) — "Save this location?"
6. On confirm: coordinates written to local record, flagged as "manually corrected", queued for sync
7. Back on client card: small map thumbnail shows the new pin

Key UX details observed:
- Draggable pin is preferred over pure tap — easier to fine-tune on mobile
- Show reverse-geocoded address string for human confirmation, not raw lat/lng
- Distinguish visually between "GPS auto" vs "manually set" coordinates (different pin color/icon)
- Do not replace coordinates silently — always confirm

## React Native Technical Implementation

### Primary approach: `react-native-maps` (most common)

```js
// MapView with tap-to-place
<MapView
  onPress={(e) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setDraftCoord({ latitude, longitude });
  }}
>
  {draftCoord && (
    <Marker
      coordinate={draftCoord}
      draggable
      onDragEnd={(e) => setDraftCoord(e.nativeEvent.coordinate)}
    />
  )}
</MapView>
```

Key properties:
- `MapView.onPress` -> `e.nativeEvent.coordinate` gives `{ latitude, longitude }`
- `Marker draggable` + `onDragEnd` allows fine-tuning after initial tap
- Works with both Google Maps provider and Apple Maps (default)

### Reverse geocoding (show address for confirmation)
- `expo-location` -> `Location.reverseGeocodeAsync({ latitude, longitude })`
- Or Google Maps Geocoding API (requires API key, works offline-cached)

### Alternative: MapLibre (`@maplibre/maplibre-react-native`)
- Better for offline tile caching (MBTiles)
- Same `onPress` -> coordinate pattern
- Preferred if offline map tiles are needed (Israel: OpenStreetMap-based tiles)

### Google Maps SDK (via `react-native-maps` with `PROVIDER_GOOGLE`)
- Requires Google Maps API key
- Better address autocomplete integration
- Works in Israel (good coverage)

## Offline Considerations

| Scenario | Recommendation |
|---|---|
| Pin placement offline | Store coordinate change locally immediately; do not wait for network |
| Queue for sync | Use WatermelonDB or a simple SQLite pending-changes table; sync on `NetInfo` reconnect or `AppState` foreground |
| Offline map tiles | MapLibre + pre-downloaded MBTiles for Israel region (~50–200MB); or `react-native-maps` with cached Google tiles (requires prior online visit to area) |
| Conflict resolution | Server wins for route data; agent wins for manually corrected coordinates (flag `manually_corrected: true`) |

Recommended stack for offline-first: `react-native-maps` (or MapLibre) + WatermelonDB + `@react-native-community/netinfo` for sync trigger.

## Israeli / Hebrew RTL Considerations

- Confirmation dialog with address string: use RTL layout (`writingDirection: 'rtl'`) for Hebrew addresses
- Hebrew street names come from reverse geocode — Google Maps covers Israel well
- No special map SDK requirement for Hebrew; Google Maps and OSM both render Hebrew labels in Israel
- RTL does not affect coordinate math — only the UI text direction

## Open-Source References

- `react-native-maps` — [github.com/react-native-maps/react-native-maps](https://github.com/react-native-maps/react-native-maps) — draggable marker + onPress documented
- `@maplibre/maplibre-react-native` — offline tile support
- WatermelonDB — [github.com/Nozbe/WatermelonDB](https://github.com/Nozbe/WatermelonDB) — offline-first sync
- No known dedicated open-source library specifically for "customer GPS correction" flow — implement as a thin component on top of `react-native-maps`

## Key Takeaways

- The feature is called "Outlet Geotagging", "GPS Tagging", or "Manual Pin" depending on the app
- Standard UX: tap/drag pin -> reverse geocode for confirmation -> save with `manually_corrected` flag
- `react-native-maps` `onPress` + `draggable Marker` is the correct and simplest React Native approach
- Offline-first: store locally immediately, sync on reconnect via WatermelonDB
- For Israel: Google Maps provider works well; Hebrew RTL only affects UI text, not map logic
