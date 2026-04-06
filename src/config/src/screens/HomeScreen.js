import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";

export default function HomeScreen({ onNavigate }) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.brand}>
          Harvey <Text style={styles.brandAccent}>Taxi</Text>
        </Text>

        <Text style={styles.title}>Real Mobility. Real Dispatch. Real Access.</Text>

        <Text style={styles.subtitle}>
          Harvey Taxi connects riders, drivers, and future autonomous fleet
          systems through one intelligent transportation platform.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Rider Access</Text>
        <Text style={styles.cardText}>
          Request secure rides with verification, payment authorization, and
          dispatch protection.
        </Text>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => onNavigate("requestRide")}
        >
          <Text style={styles.primaryButtonText}>Request Ride</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Platform Status</Text>

        <View style={styles.statusRow}>
          <View style={styles.statusBox}>
            <Text style={styles.statusLabel}>Verification</Text>
            <Text style={styles.statusValue}>Active</Text>
          </View>

          <View style={styles.statusBox}>
            <Text style={styles.statusLabel}>Dispatch Brain</Text>
            <Text style={styles.statusValue}>Online</Text>
          </View>
        </View>

        <View style={styles.statusRow}>
          <View style={styles.statusBox}>
            <Text style={styles.statusLabel}>Payments</Text>
            <Text style={styles.statusValue}>Protected</Text>
          </View>

          <View style={styles.statusBox}>
            <Text style={styles.statusLabel}>Fleet</Text>
            <Text style={styles.statusValue}>Mixed Ready</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 40,
    backgroundColor: "#040814"
  },
  hero: {
    backgroundColor: "#0b1730",
    borderRadius: 24,
    padding: 22,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)"
  },
  brand: {
    fontSize: 28,
    fontWeight: "800",
    color: "#f4f7ff",
    marginBottom: 14
  },
  brandAccent: {
    color: "#63f5ff"
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#f4f7ff",
    marginBottom: 10
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "#aab8de"
  },
  card: {
    backgroundColor: "rgba(10,17,38,0.88)",
    borderRadius: 24,
    padding: 20,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)"
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#f4f7ff",
    marginBottom: 10
  },
  cardText: {
    fontSize: 14,
    lineHeight: 21,
    color: "#aab8de",
    marginBottom: 16
  },
  primaryButton: {
    backgroundColor: "#5ea0ff",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center"
  },
  primaryButtonText: {
    color: "#041224",
    fontSize: 16,
    fontWeight: "800"
  },
  statusRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12
  },
  statusBox: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)"
  },
  statusLabel: {
    color: "#aab8de",
    fontSize: 13,
    marginBottom: 6
  },
  statusValue: {
    color: "#6dffb3",
    fontSize: 16,
    fontWeight: "800"
  }
});
