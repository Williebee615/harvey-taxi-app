// The background location task must be defined when the JavaScript bundle
// loads, before any screen renders, so the OS can deliver updates to it.
import './src/locationTask';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
