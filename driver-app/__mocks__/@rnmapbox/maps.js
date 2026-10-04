// Jest stand-in for the Mapbox native map (@rnmapbox/maps): plain views
// that keep their props, so tests can see what the trip map would draw.
const React = require('react');
const { View } = require('react-native');

const make = (name) => {
  const C = ({ children, ...props }) => React.createElement(View, { ...props, mapboxComponent: name }, children);
  C.displayName = name;
  return C;
};

const Mapbox = {
  setAccessToken: jest.fn(),
  StyleURL: { Dark: 'mapbox://styles/mapbox/dark-v11', Street: 'mapbox://styles/mapbox/streets-v12' },
  MapView: make('MapView'),
  Camera: make('Camera'),
  UserLocation: make('UserLocation'),
  PointAnnotation: make('PointAnnotation')
};

module.exports = { __esModule: true, default: Mapbox, ...Mapbox };
