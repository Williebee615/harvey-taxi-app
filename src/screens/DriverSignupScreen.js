import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { driverSignup } from "../config/api";

function CheckRow({ label, value, onPress }) {
  return (
    <Pressable onPress={onPress} style={styles.checkRow}>
      <View style={[styles.checkbox, value && styles.checkboxActive]}>
        {value ? <Text style={styles.checkmark}>✓</Text> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

export default function DriverSignupScreen({ onNavigate }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [stateValue, setStateValue] = useState("TN");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [password, setPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeScreening, setAgreeScreening] = useState(false);
  const [agreeInsurance, setAgreeInsurance] = useState(false);
  const [loading, setLoading] = useState(false);

  const formIsValid = useMemo(() => {
    return (
      firstName.trim() &&
      lastName.trim() &&
      phone.trim() &&
      email.trim() &&
      city.trim() &&
      stateValue.trim() &&
      vehicleMake.trim() &&
      vehicleModel.trim() &&
      vehicleYear.trim() &&
      licenseNumber.trim() &&
      password.trim() &&
      agreeTerms &&
      agreeScreening &&
      agreeInsurance
    );
  }, [
    firstName,
    lastName,
    phone,
    email,
    city,
    stateValue,
    vehicleMake,
    vehicleModel,
    vehicleYear,
    licenseNumber,
    password,
    agreeTerms,
    agreeScreening,
    agreeInsurance
  ]);

  async function handleDriverSignup() {
    if (!formIsValid) {
      Alert.alert(
        "Complete Signup",
        "Please fill out every field and accept all required driver consents."
      );
      return;
    }

    setLoading(true);

    try {
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        email: email.trim().toLowerCase(),
        city: city.trim(),
        state: stateValue.trim().toUpperCase(),
        password: password.trim(),
        licenseNumber: licenseNumber.trim(),
        vehicle: {
          make: vehicleMake.trim(),
          model: vehicleModel.trim(),
          year: vehicleYear.trim()
        },
        consents: {
          termsAccepted: agreeTerms,
          backgroundCheckAccepted: agreeScreening,
          insuranceConfirmed: agreeInsurance
        }
      };

      const result = await driverSignup(payload);

      const driverId =
        result?.driver?.id ||
        result?.driver_id ||
        result?.id ||
        "Generated";

      const status =
        result?.driver?.status ||
        result?.status ||
        "pending_review";

      Alert.alert(
        "Driver Signup Submitted",
        `Driver ID: ${driverId}\nStatus: ${status}`,
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
      Alert.alert(
        "Driver Signup Failed",
        error.message || "Unable to submit driver signup."
      );
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
          <Text style={styles.eyebrow}>HARVEY TAXI DRIVER NETWORK</Text>
          <Text style={styles.title}>Driver Sign Up</Text>
          <Text style={styles.subtitle}>
            Join the Harvey Taxi fleet and complete onboarding for review.
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Personal Details</Text>

          <Text style={styles.label}>First Name</Text>
          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor="#8ea2d1"
          />

          <Text style={styles.label}>Last Name</Text>
          <TextInput
            style={styles.input}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last name"
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
            placeholder="driver@email.com"
            placeholderTextColor="#8ea2d1"
            keyboardType="email-address"
            autoCapitalize="none"
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
            onChangeText={setStateValue}
            placeholder="TN"
            placeholderTextColor="#8ea2d1"
            maxLength={2}
            autoCapitalize="characters"
          />

          <Text style={styles.label}>License Number</Text>
          <TextInput
            style={styles.input}
            value={licenseNumber}
            onChangeText={setLicenseNumber}
            placeholder="Driver license number"
            placeholderTextColor="#8ea2d1"
            autoCapitalize="characters"
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

          <Text style={styles.sectionTitle}>Vehicle Details</Text>

          <Text style={styles.label}>Vehicle Make</Text>
          <TextInput
            style={styles.input}
            value={vehicleMake}
            onChangeText={setVehicleMake}
            placeholder="Toyota"
            placeholderTextColor="#8ea2d1"
          />

          <Text style={styles.label}>Vehicle Model</Text>
          <TextInput
            style={styles.input}
            value={vehicleModel}
            onChangeText={setVehicleModel}
            placeholder="Camry"
            placeholderTextColor="#8ea2d1"
          />

          <Text style={styles.label}>Vehicle Year</Text>
          <TextInput
            style={styles.input}
            value={vehicleYear}
            onChangeText={setVehicleYear}
            placeholder="2020"
            placeholderTextColor="#8ea2d1"
            keyboardType="number-pad"
          />

          <Text style={styles.sectionTitle}>Required Consents</Text>

          <CheckRow
            label="I agree to the Harvey Taxi driver terms."
            value={agreeTerms}
            onPress={() => setAgreeTerms((prev) => !prev)}
          />

          <CheckRow
            label="I consent to verification and background review."
            value={agreeScreening}
            onPress={() => setAgreeScreening((prev) => !prev)}
          />

          <CheckRow
            label="I confirm I carry required vehicle insurance."
            value={agreeInsurance}
            onPress={() => setAgreeInsurance((prev) => !prev)}
          />

          <Pressable
            style={[
              styles.primaryButton,
              (!formIsValid || loading) && styles.disabledButton
            ]}
            onPress={handleDriverSignup}
            disabled={!formIsValid || loading}
          >
            {loading ? (
              <ActivityIndicator color="#04101f" />
            ) : (
              <Text style={styles.primaryButtonText}>Submit Driver Signup</Text>
            )}
          </Pressable>

          <Pressable
            style={styles.linkButton}
            onPress={() => onNavigate && onNavigate("home")}
          >
            <Text style={styles.linkText}>Back to Home</Text>
          </Pressable>
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
    letterSpacing: 1.3,
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
  sectionTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "800",
    marginTop: 10,
    marginBottom: 12
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
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111d43",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(109, 163, 255, 0.2)",
    padding: 14,
    marginTop: 12
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#69f5ff",
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "transparent"
  },
  checkboxActive: {
    backgroundColor: "#69f5ff"
  },
  checkmark: {
    color: "#04101f",
    fontWeight: "900",
    fontSize: 16
  },
  checkLabel: {
    flex: 1,
    color: "#eef4ff",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600"
  },
  primaryButton: {
    backgroundColor: "#69f5ff",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 22
  },
  primaryButtonText: {
    color: "#03101f",
    fontSize: 16,
    fontWeight: "800"
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
