import React, { useState } from "react";
import { SafeAreaView, StatusBar, StyleSheet } from "react-native";

import HomeScreen from "./src/screens/HomeScreen";
import RequestRideScreen from "./src/screens/RequestRideScreen";

export default function App() {
  const [screen, setScreen] = useState("home");

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {screen === "home" && (
        <HomeScreen onNavigate={setScreen} />
      )}

      {screen === "requestRide" && (
        <RequestRideScreen onNavigate={setScreen} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#081226"
  }
});
