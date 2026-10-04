import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Mapbox from '@rnmapbox/maps';

import { cameraFor, legendFor, tripMapPoints } from './tripMap';
import { C } from './ui';

// Live trip map (docs/live-map-tracking.md). Shown only when the server
// sends a Mapbox public token (snapshot.map.token); without one the trip
// card works exactly as before.
let appliedToken = null;
function useMapboxToken(token) {
  if (token && token !== appliedToken) {
    Mapbox.setAccessToken(token);
    appliedToken = token;
  }
}

export default function TripMapView({ ride, token }) {
  useMapboxToken(token);
  const [me, setMe] = useState(null);
  const { markers, frame } = useMemo(() => tripMapPoints(ride, me), [ride, me]);
  const camera = cameraFor(frame);

  if (!token || !camera) return null;

  return (
    <View style={st.wrap} testID="trip-map">
      <Mapbox.MapView
        style={st.map}
        styleURL={Mapbox.StyleURL.Dark}
        scaleBarEnabled={false}
        compassEnabled={false}
        accessibilityLabel={`Trip map. ${legendFor(markers)}`}
      >
        <Mapbox.Camera {...camera} animationMode="easeTo" animationDuration={600} />
        <Mapbox.UserLocation
          visible
          minDisplacement={20}
          onUpdate={(loc) => {
            const c = loc && loc.coords;
            if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) setMe({ lat: c.latitude, lng: c.longitude });
          }}
        />
        {markers.map((m) => (
          <Mapbox.PointAnnotation key={m.id} id={`trip-${m.id}`} coordinate={[m.lng, m.lat]} title={m.label}>
            <View style={st.marker} accessibilityLabel={m.label}>
              <Text style={st.markerText}>{m.emoji}</Text>
            </View>
          </Mapbox.PointAnnotation>
        ))}
      </Mapbox.MapView>
      <Text style={st.legend}>{legendFor(markers)}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { marginTop: 10 },
  map: { height: 240, borderRadius: 14, overflow: 'hidden' },
  marker: { alignItems: 'center', justifyContent: 'center' },
  markerText: { fontSize: 24 },
  legend: { color: C.muted, fontSize: 12, marginTop: 6 }
});
