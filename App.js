import React, { useState } from "react";
import { SafeAreaView, StatusBar, StyleSheet } from "react-native";
import HomeScreen from "./src/screens/HomeScreen";
import RequestRideScreen from "./src/screens/RequestRideScreen";

export default function App() {
  const [currentScreen, setCurrentScreen] = useState("home");

  const handleNavigate = (screenName) => {
    setCurrentScreen(screenName);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      {currentScreen === "home" ? (
        <HomeScreen onNavigate={handleNavigate} />
      ) : (
        <RequestRideScreen onNavigate={handleNavigate} />
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
