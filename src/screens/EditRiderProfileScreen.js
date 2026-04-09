import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";

const API_BASE_URL = "https://harvey-taxi-app-2.onrender.com";

export default function EditRiderProfileScreen({
  riderId,
  rider: initialRider,
  onNavigate,
  onBack
}) {
  const [loading, setLoading] = useState(!initialRider);
  const [saving, setSaving] = useState(false);

  const [firstName, setFirstName] = useState(initialRider?.first_name || initialRider?.firstName || "");
  const [lastName, setLastName] = useState(initialRider?.last_name || initialRider?.lastName || "");
  const [email, setEmail] = useState(initialRider?.email || "");
  const [phone, setPhone] = useState(initialRider?.phone || initialRider?.phone_number || "");
  const [idType, setIdType] = useState(initialRider?.id_type || initialRider?.government_id_type || "");
  const [emergencyContact, setEmergencyContact] = useState(
    initialRider?.emergency_contact || initialRider?.emergencyContact || ""
  );
  const [notes, setNotes] = useState(initialRider?.notes || initialRider?.account_notes || "");
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (!initialRider && riderId) {
      loadRider();
    }
  }, [riderId]);

  const loadRider = async () => {
    try {
      setLoading(true);
      setStatusMessage("");

      const response = await fetch(`${API_BASE_URL}/api/riders/${encodeURIComponent(riderId)}`);
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || data?.message || "Unable to load rider profile.");
      }

      const rider = data?.rider || data || {};

      setFirstName(rider.first_name || rider.firstName || "");
      setLastName(rider.last_name || rider.lastName || "");
      setEmail(rider.email || "");
      setPhone(rider.phone || rider.phone_number || "");
      setIdType(rider.id_type || rider.government_id_type || "");
      setEmergencyContact(rider.emergency_contact || rider.emergencyContact || "");
      setNotes(rider.notes || rider.account_notes || "");
    } catch (error) {
      setStatusMessage(error.message || "Unable to load rider profile.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!riderId) {
      Alert.alert("Missing Rider ID", "No rider account was provided.");
      return;
    }

    if (!firstName.trim()) {
      Alert.alert("Missing First Name", "Please enter the rider's first name.");
      return;
    }

    if (!lastName.trim()) {
      Alert.alert("Missing Last Name", "Please enter the rider's last name.");
      return;
    }

    if (!phone.trim()) {
      Alert.alert("Missing Phone", "Please enter the rider's phone number.");
      return;
    }

    try {
      setSaving(true);
      setStatusMessage("");

      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        id_type: idType.trim(),
        emergency_contact: emergencyContact.trim(),
        notes: notes.trim()
      };

      const response = await fetch(`${API_BASE_URL}/api/riders/${encodeURIComponent(riderId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || data?.message || "Unable to save rider profile.");
      }

      Alert.alert("Profile Updated", "Your rider profile has been saved.");

      if (onNavigate) {
        onNavigate("riderDashboard", {
          riderId,
          rider: data?.rider || payload
        });
      }
    } catch (error) {
      setStatusMessage(error.message || "Unable to save rider profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#66ebff" />
          <Text style={styles.loadingText}>Loading rider profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.heroCard}>
            <Text style={styles.eyebrow}>HARVEY TAXI MOBILE</Text>
            <Text style={styles.heroTitle}>Edit Rider Profile</Text>
            <Text style={styles.heroSubtitle}>
              Update your rider information, emergency contact details, and account notes.
            </Text>
          </View>

          {statusMessage ? (
            <View style={styles.alertCard}>
              <Text style={styles.alertTitle}>Profile Notice</Text>
              <Text style={styles.alertText}>{statusMessage}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Basic Information</Text>

            <Text style={styles.label}>First Name</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Enter first name"
              placeholderTextColor="#7f8eb7"
            />

            <Text style={styles.label}>Last Name</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Enter last name"
              placeholderTextColor="#7f8eb7"
            />

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Enter email address"
              placeholderTextColor="#7f8eb7"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.label}>Phone</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="Enter phone number"
              placeholderTextColor="#7f8eb7"
              keyboardType="phone-pad"
            />

            <Text style={styles.label}>Government ID Type</Text>
            <TextInput
              style={styles.input}
              value={idType}
              onChangeText={setIdType}
              placeholder="State ID, Passport, Driver License"
              placeholderTextColor="#7f8eb7"
            />

            <Text style={styles.label}>Emergency Contact</Text>
            <TextInput
              style={styles.input}
              value={emergencyContact}
              onChangeText={setEmergencyContact}
              placeholder="Name and phone number"
              placeholderTextColor="#7f8eb7"
            />

            <Text style={styles.label}>Account Notes</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Helpful rider information"
              placeholderTextColor="#7f8eb7"
              multiline
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.primaryButtonText}>
              {saving ? "Saving Profile..." : "Save Rider Profile"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => {
              if (onBack) return onBack();
              if (onNavigate) {
                onNavigate("riderDashboard", { riderId });
              }
            }}
          >
            <Text style={styles.secondaryButtonText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#020817"
  },
  container: {
    padding: 18,
    paddingBottom: 40,
    backgroundColor: "#020817"
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#020817"
  },
  loadingText: {
    marginTop: 14,
    color: "#c8d5ff",
    fontSize: 16,
    fontWeight: "600"
  },
  heroCard: {
    backgroundColor: "rgba(10,18,42,0.95)",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(99,196,255,0.18)",
    padding: 22,
    marginBottom: 18
  },
  eyebrow: {
    color: "#6ee7ff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 8
  },
  heroTitle: {
    color: "#f7fbff",
    fontSize: 28,
    fontWeight: "900",
    marginBottom: 8
  },
  heroSubtitle: {
    color: "#afc1ee",
    fontSize: 15,
    lineHeight: 22
  },
  alertCard: {
    backgroundColor: "rgba(40,17,34,0.88)",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,120,160,0.25)",
    padding: 18,
    marginBottom: 18
  },
  alertTitle: {
    color: "#ffd1df",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8
  },
  alertText: {
    color: "#ffe8ef",
    fontSize: 15,
    lineHeight: 22
  },
  card: {
    backgroundColor: "rgba(8,16,38,0.95)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(110,170,255,0.16)",
    padding: 20,
    marginBottom: 18
  },
  sectionTitle: {
    color: "#f7fbff",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 16
  },
  label: {
    color: "#a8bbeb",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8,
    marginTop: 8
  },
  input: {
    backgroundColor: "rgba(14,24,54,0.96)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(110,170,255,0.16)",
    paddingHorizontal: 16,
    paddingVertical: 15,
    color: "#f5f9ff",
    fontSize: 16,
    marginBottom: 6
  },
  notesInput: {
    minHeight: 120,
    paddingTop: 16
  },
  primaryButton: {
    backgroundColor: "#63dfff",
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14
  },
  disabledButton: {
    opacity: 0.5
  },
  primaryButtonText: {
    color: "#06111f",
    fontSize: 18,
    fontWeight: "900"
  },
  secondaryButton: {
    backgroundColor: "rgba(90,130,255,0.12)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(110,170,255,0.20)",
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryButtonText: {
    color: "#d8e7ff",
    fontSize: 17,
    fontWeight: "800"
  }
});
