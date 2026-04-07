import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import * as Location from "expo-location";
import {
  authorizePayment,
  getFareEstimate,
  getRiders,
  requestRide
} from "../config/api";

export default function RequestRideScreen({ onNavigate }) {
  const [riderId, setRiderId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [rideType, setRideType] = useState("standard");
  const [scheduledTime, setScheduledTime] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("card");

  const [verificationText, setVerificationText] = useState(
    "Enter your rider ID to check your account status."
  );
  const [verificationStatus, setVerificationStatus] = useState("Pending");

  const [paymentText, setPaymentText] = useState(
    "No payment has been secured yet."
  );
  const [paymentStatus, setPaymentStatus] = useState("Not Secured");

  const [locationApproved, setLocationApproved] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [locationText, setLocationText] = useState(
    "Location access is recommended for pickup coordination. You can also continue by entering your pickup address manually."
  );
  const [currentCoords, setCurrentCoords] = useState(null);

  const [currentEstimate, setCurrentEstimate] = useState(null);
  const [paymentAuthorized, setPaymentAuthorized] = useState(false);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [loadingRide, setLoadingRide] = useState(false);

  useEffect(() => {
    checkExistingLocationPermission();
  }, []);

  async function checkExistingLocationPermission() {
    try {
      setLoadingLocation(true);

      const existing = await Location.getForegroundPermissionsAsync();

      if (existing.status === "granted") {
        setLocationApproved(true);
        setLocationText("Location access is enabled. Harvey Taxi can use your device location for better pickup coordination.");
        await getCurrentDeviceLocation();
      } else {
        setLocationApproved(false);
        setLocationText(
          "Location access is not enabled yet. You can enable it now or continue by entering your pickup address manually."
        );
      }
    } catch (error) {
      setLocationApproved(false);
      setLocationText(
        "Unable to confirm location status right now. You can still continue with manual pickup address entry."
      );
    } finally {
      setLoadingLocation(false);
    }
  }

  async function getCurrentDeviceLocation() {
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });

      setCurrentCoords({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      });

      setLocationApproved(true);
      setLocationText("Location enabled successfully. You can continue with ride details below.");
    } catch (error) {
      setLocationApproved(true);
      setLocationText(
        "Location permission is enabled, but we could not fetch your exact position right now. You can still continue by typing your pickup address."
      );
    }
  }

  async function askForLocation() {
    try {
      setLoadingLocation(true);
      setLocationText("Requesting location access...");

      const permission = await Location.requestForegroundPermissionsAsync();

      if (permission.status !== "granted") {
        setLocationApproved(false);
        setCurrentCoords(null);
        setLocationText(
          "Location access was not granted. You can still continue by entering your pickup address manually."
        );
        Alert.alert(
          "Location Not Enabled",
          "You can still use Harvey Taxi by entering your pickup address manually."
        );
        return;
      }

      setLocationApproved(true);
      setLocationText("Location access granted. Getting your current location...");

      await getCurrentDeviceLocation();
    } catch (error) {
      setLocationApproved(false);
      setCurrentCoords(null);
      setLocationText(
        "Unable to request location access right now. You can still continue manually."
      );
      Alert.alert(
        "Location Error",
        "Unable to request location access right now. Please enter your pickup address manually."
      );
    } finally {
      setLoadingLocation(false);
    }
  }

  async function checkRiderStatus() {
    if (!riderId.trim()) {
      setVerificationText("Enter your rider ID to check your account status.");
      setVerificationStatus("Pending");
      return false;
    }

    try {
      const data = await getRiders();

      if (!data.ok || !Array.isArray(data.riders)) {
        setVerificationText("Unable to load rider account status.");
        setVerificationStatus("Error");
        return false;
      }

      const rider = data.riders.find((item) => item.id === riderId.trim());

      if (!rider) {
        setVerificationText("We could not find that rider account.");
        setVerificationStatus("Not Found");
        return false;
      }

      const approved = !!rider.riderApproved;

      setVerificationText(
        approved
          ? "Your rider account is approved and ready for payment authorization."
          : "Your rider account exists but is still waiting for approval."
      );
      setVerificationStatus(approved ? "Approved" : "Pending");

      return approved;
    } catch (error) {
      setVerificationText("Unable to check rider verification right now.");
      setVerificationStatus("Error");
      return false;
    }
  }

  async function handleEstimate() {
    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      Alert.alert(
        "Missing Info",
        "Enter both pickup and dropoff addresses first."
      );
      return;
    }

    try {
      setLoadingEstimate(true);

      const data = await getFareEstimate({
        pickupAddress: pickupAddress.trim(),
        dropoffAddress: dropoffAddress.trim(),
        rideType
      });

      if (!data.ok || !data.fare) {
        Alert.alert("Estimate Error", "Unable to calculate estimate.");
        return;
      }

      setCurrentEstimate(data.fare);

      Alert.alert(
        "Fare Estimate Ready",
        `Estimated fare: $${Number(data.fare.estimatedFare || 0).toFixed(2)}`
      );
    } catch (error) {
      Alert.alert(
        "Estimate Error",
        error.message || "Unable to calculate fare."
      );
    } finally {
      setLoadingEstimate(false);
    }
  }

  async function handleAuthorizePayment() {
    if (!riderId.trim()) {
      Alert.alert(
        "Missing Rider ID",
        "Enter your rider ID before securing payment."
      );
      return;
    }

    if (!currentEstimate) {
      Alert.alert(
        "Estimate Required",
        "Get a fare estimate before securing payment."
      );
      return;
    }

    try {
      setLoadingPayment(true);

      const data = await authorizePayment({
        riderId: riderId.trim(),
        paymentMethod,
        amount: currentEstimate.estimatedFare
      });

      if (!data.ok) {
        setPaymentAuthorized(false);
        setPaymentText("Payment authorization failed.");
        setPaymentStatus("Failed");
        Alert.alert("Payment Failed", data.error || "Unable to secure payment.");
        return;
      }

      setPaymentAuthorized(true);
      setPaymentText(
        `Payment secured by ${
          paymentMethod === "apple_pay" ? "Apple Pay" : "Card"
        }.`
      );
      setPaymentStatus("Secured");

      Alert.alert("Payment Secured", "Your payment has been authorized.");
    } catch (error) {
      setPaymentAuthorized(false);
      setPaymentText("Payment service unavailable.");
      setPaymentStatus("Error");
      Alert.alert(
        "Payment Error",
        error.message || "Unable to authorize payment."
      );
    } finally {
      setLoadingPayment(false);
    }
  }

  async function handleRequestRide() {
    if (!riderId.trim()) {
      Alert.alert("Missing Rider ID", "Enter your rider ID.");
      return;
    }

    if (!firstName.trim() || !phone.trim()) {
      Alert.alert(
        "Missing Passenger Info",
        "Enter passenger first name and phone number."
      );
      return;
    }

    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      Alert.alert(
        "Missing Addresses",
        "Enter pickup and dropoff addresses."
      );
      return;
    }

    if (!currentEstimate) {
      Alert.alert("Estimate Required", "Get a fare estimate first.");
      return;
    }

    const approved = await checkRiderStatus();

    if (!approved) {
      Alert.alert(
        "Verification Required",
        "Your rider account must be approved before you can request a ride."
      );
      return;
    }

    if (!paymentAuthorized) {
      Alert.alert(
        "Payment Required",
        "Payment must be secured before your ride can be requested."
      );
      return;
    }

    try {
      setLoadingRide(true);

      const data = await requestRide({
        riderId: riderId.trim(),
        pickupAddress: pickupAddress.trim(),
        dropoffAddress: dropoffAddress.trim(),
        rideType,
        passengerCount: 1,
        riderLocationApproved: locationApproved,
        riderCoordinates: currentCoords || null,
        specialInstructions: [
          firstName ? `Passenger: ${firstName}` : "",
          phone ? `Phone: ${phone}` : "",
          scheduledTime ? `Scheduled Time: ${scheduledTime}` : "",
          notes ? `Notes: ${notes}` : "",
          `Payment Method: ${
            paymentMethod === "apple_pay" ? "Apple Pay" : "Card"
          }`,
          locationApproved
            ? "Location Permission: Enabled"
            : "Location Permission: Manual Address Entry"
        ]
          .filter(Boolean)
          .join(" | ")
      });

      Alert.alert(
        "Ride Requested",
        `Ride ID: ${data.ride?.id || "Created"}\nStatus: ${
          data.ride?.status || "searching_driver"
        }`
      );
    } catch (error) {
      Alert.alert(
        "Ride Request Error",
        error.message || "Unable to request ride."
      );
    } finally {
      setLoadingRide(false);
    }
  }

  function renderRideTypeButton(value, label) {
    const active = rideType === value;

    return (
      <TouchableOpacity
        key={value}
        style={[styles.pill, active && styles.pillActive]}
        onPress={() => setRideType(value)}
      >
        <Text style={[styles.pillText, active && styles.pillTextActive]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => onNavigate("home")}
      >
        <Text style={styles.backButtonText}>← Return Home</Text>
      </TouchableOpacity>

      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Request Your Ride</Text>
        <Text style={styles.heroText}>
          Harvey Taxi requires approved rider verification and secured payment
          before dispatch.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Location Status</Text>
        <Text style={styles.cardText}>{locationText}</Text>

        <View style={styles.statusBox}>
          <Text style={styles.statusLabel}>Location Permission</Text>
          <Text style={styles.statusText}>
            {locationApproved ? "Enabled" : "Manual entry mode available"}
          </Text>
          <Text
            style={[
              styles.statusValue,
              !locationApproved && styles.statusValueWarning
            ]}
          >
            {locationApproved ? "Ready" : "Optional"}
          </Text>
        </View>

        {currentCoords && (
          <View style={styles.statusBox}>
            <Text style={styles.statusLabel}>Device Location</Text>
            <Text style={styles.statusText}>
              Current device coordinates captured successfully for pickup support.
            </Text>
            <Text style={styles.statusValue}>Connected</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={askForLocation}
          disabled={loadingLocation}
        >
          <Text style={styles.secondaryButtonText}>
            {loadingLocation ? "Requesting Location..." : "Enable Location"}
          </Text>
        </TouchableOpacity>

        <Text style={styles.helperText}>
          You can still continue by typing your pickup address manually.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Rider Security Gate</Text>

        <View style={styles.statusBox}>
          <Text style={styles.statusLabel}>Verification Status</Text>
          <Text style={styles.statusText}>{verificationText}</Text>
          <Text
            style={[
              styles.statusValue,
              verificationStatus !== "Approved" && styles.statusValueWarning
            ]}
          >
            {verificationStatus}
          </Text>
        </View>

        <View style={styles.statusBox}>
          <Text style={styles.statusLabel}>Payment Status</Text>
          <Text style={styles.statusText}>{paymentText}</Text>
          <Text
            style={[
              styles.statusValue,
              paymentStatus !== "Secured" && styles.statusValueWarning
            ]}
          >
            {paymentStatus}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ride Request</Text>

        <TextInput
          style={styles.input}
          placeholder="Rider ID"
          placeholderTextColor="rgba(244,247,255,0.46)"
          value={riderId}
          onChangeText={setRiderId}
          onBlur={checkRiderStatus}
        />

        <TextInput
          style={styles.input}
          placeholder="Passenger First Name"
          placeholderTextColor="rgba(244,247,255,0.46)"
          value={firstName}
          onChangeText={setFirstName}
        />

        <TextInput
          style={styles.input}
          placeholder="Passenger Phone"
          placeholderTextColor="rgba(244,247,255,0.46)"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />

        <TextInput
          style={styles.input}
          placeholder="Pickup Address"
          placeholderTextColor="rgba(244,247,255,0.46)"
          value={pickupAddress}
          onChangeText={setPickupAddress}
        />

        <TextInput
          style={styles.input}
          placeholder="Dropoff Address"
          placeholderTextColor="rgba(244,247,255,0.46)"
          value={dropoffAddress}
          onChangeText={setDropoffAddress}
        />

        <TextInput
          style={styles.input}
          placeholder="Scheduled Time (optional)"
          placeholderTextColor="rgba(244,247,255,0.46)"
          value={scheduledTime}
          onChangeText={setScheduledTime}
        />

        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Ride Notes"
          placeholderTextColor="rgba(244,247,255,0.46)"
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        <Text style={styles.sectionLabel}>Ride Type</Text>
        <View style={styles.pillRow}>
          {renderRideTypeButton("standard", "Standard")}
          {renderRideTypeButton("scheduled", "Scheduled")}
          {renderRideTypeButton("airport", "Airport")}
          {renderRideTypeButton("medical", "Medical")}
          {renderRideTypeButton("nonprofit", "Nonprofit")}
        </View>

        <Text style={styles.sectionLabel}>Payment Method</Text>
        <View style={styles.pillRow}>
          <TouchableOpacity
            style={[styles.pill, paymentMethod === "card" && styles.pillActive]}
            onPress={() => setPaymentMethod("card")}
          >
            <Text
              style={[
                styles.pillText,
                paymentMethod === "card" && styles.pillTextActive
              ]}
            >
              Card
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.pill,
              paymentMethod === "apple_pay" && styles.pillActive
            ]}
            onPress={() => setPaymentMethod("apple_pay")}
          >
            <Text
              style={[
                styles.pillText,
                paymentMethod === "apple_pay" && styles.pillTextActive
              ]}
            >
              Apple Pay
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleEstimate}
          disabled={loadingEstimate}
        >
          <Text style={styles.secondaryButtonText}>
            {loadingEstimate ? "Getting Estimate..." : "Get Fare Estimate"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleAuthorizePayment}
          disabled={loadingPayment}
        >
          <Text style={styles.secondaryButtonText}>
            {loadingPayment ? "Securing Payment..." : "Secure Payment"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ride Estimate</Text>

        <View style={styles.estimateRow}>
          <View style={styles.estimateBox}>
            <Text style={styles.estimateLabel}>Miles</Text>
            <Text style={styles.estimateValue}>
              {currentEstimate ? `${currentEstimate.distanceMiles} mi` : "--"}
            </Text>
          </View>

          <View style={styles.estimateBox}>
            <Text style={styles.estimateLabel}>Trip Time</Text>
            <Text style={styles.estimateValue}>
              {currentEstimate ? `${currentEstimate.durationMinutes} min` : "--"}
            </Text>
          </View>

          <View style={styles.estimateBox}>
            <Text style={styles.estimateLabel}>Fare</Text>
            <Text style={styles.estimateValue}>
              {currentEstimate
                ? `$${Number(currentEstimate.estimatedFare || 0).toFixed(2)}`
                : "--"}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleRequestRide}
          disabled={loadingRide}
        >
          <Text style={styles.primaryButtonText}>
            {loadingRide ? "Requesting Ride..." : "Request Ride"}
          </Text>
        </TouchableOpacity>

        {(loadingLocation || loadingEstimate || loadingPayment || loadingRide) && (
          <ActivityIndicator
            size="small"
            color="#63f5ff"
            style={{ marginTop: 16 }}
          />
        )}
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
  backButton: {
    marginBottom: 14,
    alignSelf: "flex-start"
  },
  backButtonText: {
    color: "#f4f7ff",
    fontSize: 15,
    fontWeight: "700"
  },
  hero: {
    backgroundColor: "#0b1730",
    borderRadius: 24,
    padding: 22,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)"
  },
  heroTitle: {
    color: "#f4f7ff",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 8
  },
  heroText: {
    color: "#aab8de",
    fontSize: 14,
    lineHeight: 21
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
    color: "#f4f7ff",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 12
  },
  cardText: {
    color: "#aab8de",
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 12
  },
  statusBox: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)"
  },
  statusLabel: {
    color: "#aab8de",
    fontSize: 13,
    marginBottom: 8
  },
  statusText: {
    color: "#f4f7ff",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8
  },
  statusValue: {
    color: "#6dffb3",
    fontSize: 15,
    fontWeight: "800"
  },
  statusValueWarning: {
    color: "#ffd76a"
  },
  helperText: {
    color: "#aab8de",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10
  },
  input: {
    backgroundColor: "rgba(15,23,52,0.72)",
    color: "#f4f7ff",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)"
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: "top"
  },
  sectionLabel: {
    color: "#aab8de",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 6,
    marginBottom: 10
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)"
  },
  pillActive: {
    backgroundColor: "rgba(99,245,255,0.12)",
    borderColor: "rgba(99,245,255,0.5)"
  },
  pillText: {
    color: "#f4f7ff",
    fontWeight: "700"
  },
  pillTextActive: {
    color: "#dfffff"
  },
  primaryButton: {
    backgroundColor: "#5ea0ff",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8
  },
  primaryButtonText: {
    color: "#041224",
    fontSize: 16,
    fontWeight: "800"
  },
  secondaryButton: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)"
  },
  secondaryButtonText: {
    color: "#f4f7ff",
    fontSize: 15,
    fontWeight: "800"
  },
  estimateRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 14
  },
  estimateBox: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 18,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)"
  },
  estimateLabel: {
    color: "#aab8de",
    fontSize: 12,
    marginBottom: 6
  },
  estimateValue: {
    color: "#f4f7ff",
    fontSize: 15,
    fontWeight: "800"
  }
});
