import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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

function normalizeYear(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+()\-\s]/g, "");
}

function CheckRow({ label, value, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.checkRow,
        value && styles.checkRowActive,
        pressed && styles.checkRowPressed
      ]}
      android_ripple={{ color: "rgba(105,245,255,0.10)" }}
      hitSlop={8}
    >
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
    return Boolean(
      firstName.trim() &&
        lastName.trim() &&
        phone.trim() &&
        email.trim() &&
        city.trim() &&
        stateValue.trim() &&
        vehicleMake.trim() &&
        vehicleModel.trim() &&
        normalizeYear(vehicleYear).length === 4 &&
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

  function resetForm() {
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setCity("");
    setStateValue("TN");
    setVehicleMake("");
    setVehicleModel("");
    setVehicleYear("");
    setLicenseNumber("");
    setPassword("");
    setAgreeTerms(false);
    setAgreeScreening(false);
    setAgreeInsurance(false);
  }

  async function handleDriverSignup() {
    Keyboard.dismiss();

    if (!firstName.trim()) {
      Alert.alert("Missing First Name", "Please enter your first name.");
      return;
    }

    if (!lastName.trim()) {
      Alert.alert("Missing Last Name", "Please enter your last name.");
      return;
    }

    if (!phone.trim()) {
      Alert.alert("Missing Phone", "Please enter your phone number.");
      return;
    }

    if (!email.trim()) {
      Alert.alert("Missing Email", "Please enter your email address.");
      return;
    }

    if (!city.trim()) {
      Alert.alert("Missing City", "Please enter your operating city.");
      return;
    }

    if (!stateValue.trim()) {
      Alert.alert("Missing State", "Please enter your state.");
      return;
    }

    if (!licenseNumber.trim()) {
      Alert.alert("Missing License Number", "Please enter your driver license number.");
      return;
    }

    if (!vehicleMake.trim() || !vehicleModel.trim() || normalizeYear(vehicleYear).length !== 4) {
      Alert.alert(
        "Missing Vehicle Details",
        "Please enter a valid vehicle make, model, and 4-digit year."
      );
      return;
    }

    if (!password.trim()) {
      Alert.alert("Missing Password", "Please create a password.");
      return;
    }

    if (!agreeTerms || !agreeScreening || !agreeInsurance) {
      Alert.alert(
        "Required Consents",
        "Please tap and accept all required driver consents before submitting."
      );
      return;
    }

    setLoading(true);

    try {
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: normalizePhone(phone.trim()),
        email: email.trim().toLowerCase(),
        city: city.trim(),
        state: stateValue.trim().toUpperCase(),
        password: password.trim(),
        licenseNumber: licenseNumber.trim(),
        vehicleMake: vehicleMake.trim(),
        vehicleModel: vehicleModel.trim(),
        vehicleYear: normalizeYear(vehicleYear),
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
        result?.driver?.verification_status ||
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
              resetForm();
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
        error?.message || "Unable to submit driver signup right now."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
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
            returnKeyType="next"
          />

          <Text style={styles.label}>Last Name</Text>
          <TextInput
            style={styles.input}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last name"
            placeholderTextColor="#8ea2d1"
            returnKeyType="next"
          />

          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={(text) => setPhone(normalizePhone(text))}
            placeholder="6155551234"
            placeholderTextColor="#8ea2d1"
            keyboardType="phone-pad"
            returnKeyType="next"
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
            autoCorrect={false}
            returnKeyType="next"
          />

          <Text style={styles.label}>City</Text>
          <TextInput
            style={styles.input}
            value={city}
            onChangeText={setCity}
            placeholder="Nashville"
            placeholderTextColor="#8ea2d1"
            returnKeyType="next"
          />

          <Text style={styles.label}>State</Text>
          <TextInput
            style={styles.input}
            value={stateValue}
            onChangeText={(text) => setStateValue(text.toUpperCase().slice(0, 2))}
            placeholder="TN"
            placeholderTextColor="#8ea2d1"
            maxLength={2}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="next"
          />

          <Text style={styles.label}>License Number</Text>
          <TextInput
            style={styles.input}
            value={licenseNumber}
            onChangeText={setLicenseNumber}
            placeholder="Driver license number"
            placeholderTextColor="#8ea2d1"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="next"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Create password"
            placeholderTextColor="#8ea2d1"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />

          <Text style={styles.sectionTitle}>Vehicle Details</Text>

          <Text style={styles.label}>Vehicle Make</Text>
          <TextInput
            style={styles.input}
            value={vehicleMake}
            onChangeText={setVehicleMake}
            placeholder="Toyota"
            placeholderTextColor="#8ea2d1"
            returnKeyType="next"
          />

          <Text style={styles.label}>Vehicle Model</Text>
          <TextInput
            style={styles.input}
            value={vehicleModel}
            onChangeText={setVehicleModel}
            placeholder="Camry"
            placeholderTextColor="#8ea2d1"
            returnKeyType="next"
          />

          <Text style={styles.label}>Vehicle Year</Text>
          <TextInput
            style={styles.input}
            value={vehicleYear}
            onChangeText={(text) => setVehicleYear(normalizeYear(text))}
            placeholder="2020"
            placeholderTextColor="#8ea2d1"
            keyboardType="number-pad"
            maxLength={4}
            returnKeyType="done"
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

          <View style={styles.formStateWrap}>
            <Text style={[styles.formStateText, formIsValid && styles.formStateTextReady]}>
              {formIsValid
                ? "All required fields and consents are complete."
                : "Complete all required fields and tap all three consent boxes."}
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              loading && styles.disabledButton,
              pressed && !loading && styles.primaryButtonPressed
            ]}
            onPress={handleDriverSignup}
            disabled={loading}
            android_ripple={{ color: "rgba(3,16,31,0.10)" }}
          >
            {loading ? (
              <ActivityIndicator color="#04101f" />
            ) : (
              <Text style={styles.primaryButtonText}>Submit Driver Signup</Text>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.linkButton,
              pressed && styles.linkButtonPressed
            ]}
            onPress={() => onNavigate && onNavigate("home")}
            hitSlop={8}
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
    alignItems: "flex-start",
    backgroundColor: "#111d43",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(109, 163, 255, 0.2)",
    padding: 14,
    marginTop: 12
  },
  checkRowActive: {
    borderColor: "rgba(105, 245, 255, 0.55)",
    backgroundColor: "rgba(105, 245, 255, 0.07)"
  },
  checkRowPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.995 }]
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#69f5ff",
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "transparent",
    marginTop: 1
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
  formStateWrap: {
    marginTop: 16,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(109, 163, 255, 0.15)"
  },
  formStateText: {
    color: "#a7b9df",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600"
  },
  formStateTextReady: {
    color: "#69f5ff"
  },
  primaryButton: {
    backgroundColor: "#69f5ff",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 22,
    minHeight: 56
  },
  primaryButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.995 }]
  },
  primaryButtonText: {
    color: "#03101f",
    fontSize: 16,
    fontWeight: "800"
  },
  disabledButton: {
    opacity: 0.6
  },
  linkButton: {
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 14
  },
  linkButtonPressed: {
    opacity: 0.8
  },
  linkText: {
    color: "#8db5ff",
    fontSize: 15,
    fontWeight: "700"
  }
});
