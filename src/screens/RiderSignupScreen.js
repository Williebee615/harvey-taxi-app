import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { healthCheck, riderSignup, API_BASE_URL } from "../config/api";

export default function RiderSignupScreen({ onNavigate }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [stateValue, setStateValue] = useState("TN");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [systemMessage, setSystemMessage] = useState(
    `Connected service: ${API_BASE_URL}`
  );

  const formIsValid = useMemo(() => {
    return Boolean(
      firstName.trim() &&
        lastName.trim() &&
        phone.trim() &&
        email.trim() &&
        city.trim() &&
        stateValue.trim() &&
        password.trim() &&
        confirmPassword.trim()
    );
  }, [
    firstName,
    lastName,
    phone,
    email,
    city,
    stateValue,
    password,
    confirmPassword
  ]);

  async function testBackend() {
    setLoading(true);
    setSystemMessage("Checking Harvey Taxi service...");

    try {
      const result = await healthCheck();

      if (result?.ok === false) {
        setSystemMessage(`Backend check failed: ${result.error}`);
        Alert.alert(
          "Connection Issue",
          result.error || "Unable to reach the Harvey Taxi backend."
        );
      } else {
        setSystemMessage("Backend is reachable and responding.");
        Alert.alert("Backend Connected", "Harvey Taxi service is reachable.");
      }
    } catch (error) {
      const message = error.message || "Unable to reach the backend.";
      setSystemMessage(`Backend check failed: ${message}`);
      Alert.alert("Connection Issue", message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    if (!formIsValid) {
      Alert.alert("Missing Info", "Please complete all rider signup fields.");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("Password Mismatch", "Your passwords do not match.");
      return;
    }

    setLoading(true);
    setSystemMessage("Creating rider account...");

    try {
      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        email: email.trim().toLowerCase(),
        city: city.trim(),
        state: stateValue.trim().toUpperCase(),
        password: password.trim()
      };

      const result = await riderSignup(payload);

      const rider = result?.rider || {};
      const riderId = rider.id || result?.rider_id || result?.id || "Generated";
      const approvalText =
        rider.verification_status ||
        result?.status ||
        rider.status ||
        "pending";

      setSystemMessage("Rider signup completed.");

      Alert.alert(
        "Rider Signup Submitted",
        `Rider ID: ${riderId}\nStatus: ${approvalText}`,
        [
          {
            text: "OK",
            onPress: () => {
              if (onNavigate) {
                onNavigate("home");
              }
            }
          }
        ]
      );
    } catch (error) {
      const message =
        error.message ||
        "Rider signup failed. Please verify the backend and try again.";
      setSystemMessage(`Signup failed: ${message}`);
      Alert.alert("Signup Failed", message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>HARVEY TAXI</Text>
          <Text style={styles.title}>Rider Sign Up</Text>
          <Text style={styles.subtitle}>
            Create your rider profile before requesting transportation.
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Rider Details</Text>

          <Text style={styles.label}>First Name</Text>
          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Willie"
            placeholderTextColor="#8ea2d1"
          />

          <Text style={styles.label}>Last Name</Text>
          <TextInput
            style={styles.input}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Harvey"
            placeholderTextColor="#8ea2d1"
          />

          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="6155551234"
            placeholderTextColor="#8ea2d1"
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="name@email.com"
            placeholderTextColor="#8ea2d1"
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>City</Text>
          <TextInput
            style={styles.input}
            value={city}
            onChangeText={setCity}
            placeholder="Nashville"
            placeholderTextColor="#8ea2d1"
          />

          <Text style={styles.label}>State</Text>
          <TextInput
            style={styles.input}
            value={stateValue}
            onChangeText={(value) => setStateValue(value.toUpperCase())}
            placeholder="TN"
            placeholderTextColor="#8ea2d1"
            autoCapitalize="characters"
            maxLength={2}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Create password"
            placeholderTextColor="#8ea2d1"
            secureTextEntry
          />

          <Text style={styles.label}>Confirm Password</Text>
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm password"
            placeholderTextColor="#8ea2d1"
            secureTextEntry
          />

          <View style={styles.statusBox}>
            <Text style={styles.statusLabel}>System Status</Text>
            <Text style={styles.statusText}>{systemMessage}</Text>
          </View>

          <TouchableOpacity
            style={[styles.secondaryButton, loading && styles.disabledButton]}
            onPress={testBackend}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryButtonText}>Test Backend</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              (!formIsValid || loading) && styles.disabledButton
            ]}
            onPress={handleSignup}
            disabled={!formIsValid || loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#04101f" />
            ) : (
              <Text style={styles.primaryButtonText}>Create Rider Account</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => onNavigate && onNavigate("home")}
            activeOpacity={0.8}
          >
            <Text style={styles.linkText}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: "#040814"
  },
  screen: {
    flex: 1,
    backgroundColor: "#040814"
  },
  content: {
    padding: 20,
    paddingBottom: 40
  },
  heroCard: {
    backgroundColor: "#0b1330",
    borderWidth: 1,
    borderColor: "rgba(103, 167, 255, 0.25)",
    borderRadius: 24,
    padding: 22,
    marginBottom: 18
  },
  eyebrow: {
    color: "#69f5ff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 10
  },
  title: {
    color: "#f4f8ff",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 8
  },
  subtitle: {
    color: "#b8c7ea",
    fontSize: 15,
    lineHeight: 22
  },
  panel: {
    backgroundColor: "#0c1533",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(103, 167, 255, 0.18)",
    padding: 18
  },
  panelTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 18
  },
  label: {
    color: "#d9e5ff",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8,
    marginTop: 10
  },
  input: {
    backgroundColor: "#111d43",
    color: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(109, 163, 255, 0.2)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16
  },
  statusBox: {
    marginTop: 18,
    backgroundColor: "#101b3d",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(106, 245, 255, 0.18)",
    padding: 14
  },
  statusLabel: {
    color: "#69f5ff",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6
  },
  statusText: {
    color: "#dbe5ff",
    fontSize: 14,
    lineHeight: 20
  },
  primaryButton: {
    backgroundColor: "#69f5ff",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 18
  },
  primaryButtonText: {
    color: "#03101f",
    fontSize: 16,
    fontWeight: "800"
  },
  secondaryButton: {
    backgroundColor: "#18295a",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 16,
    borderWidth: 1,
    borderColor: "rgba(105, 245, 255, 0.18)"
  },
  secondaryButtonText: {
    color: "#f4f8ff",
    fontSize: 15,
    fontWeight: "700"
  },
  disabledButton: {
    opacity: 0.55
  },
  linkButton: {
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 10
  },
  linkText: {
    color: "#8db5ff",
    fontSize: 15,
    fontWeight: "700"
  }
});
