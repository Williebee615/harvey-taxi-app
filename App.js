import React, { useMemo, useState, useCallback } from "react";
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Platform
} from "react-native";

import HomeScreen from "./src/screens/HomeScreen";
import RequestRideScreen from "./src/screens/RequestRideScreen";

const SCREENS = {
  HOME: "home",
  REQUEST_RIDE: "requestRide"
};

export default function App() {
  const [screen, setScreen] = useState(SCREENS.HOME);

  const navigate = useCallback((nextScreen) => {
    if (!Object.values(SCREENS).includes(nextScreen)) {
      console.warn("Invalid screen:", nextScreen);
      return;
    }

    setScreen(nextScreen);
  }, []);

  const activeScreen = useMemo(() => {
    switch (screen) {
      case SCREENS.REQUEST_RIDE:
        return <RequestRideScreen onNavigate={navigate} />;

      case SCREENS.HOME:
      default:
        return <HomeScreen onNavigate={navigate} />;
    }
  }, [screen, navigate]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="#081226"
      />

      <View style={styles.appShell}>
        {activeScreen}
      </View>

      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={[
            styles.navButton,
            screen === SCREENS.HOME && styles.navButtonActive
          ]}
          onPress={() => navigate(SCREENS.HOME)}
        >
          <Text
            style={[
              styles.navText,
              screen === SCREENS.HOME && styles.navTextActive
            ]}
          >
            🏠 Home
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navButton,
            screen === SCREENS.REQUEST_RIDE && styles.navButtonActive
          ]}
          onPress={() => navigate(SCREENS.REQUEST_RIDE)}
        >
          <Text
            style={[
              styles.navText,
              screen === SCREENS.REQUEST_RIDE && styles.navTextActive
            ]}
          >
            🚖 Ride
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#081226"
  },

  appShell: {
    flex: 1,
    backgroundColor: "#081226"
  },

  bottomNav: {
    minHeight: Platform.OS === "ios" ? 82 : 72,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 24 : 14,
    backgroundColor: "#050b18",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center"
  },

  navButton: {
    flex: 1,
    minHeight: 48,
    marginHorizontal: 6,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)"
  },

  navButtonActive: {
    backgroundColor: "rgba(99,245,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(99,245,255,0.35)"
  },

  navText: {
    color: "#AAB8DE",
    fontWeight: "800",
    fontSize: 13
  },

  navTextActive: {
    color: "#63F5FF"
  }
});
