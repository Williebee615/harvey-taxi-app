import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";

const API_BASE_URL = "https://harvey-taxi-app-2.onrender.com";

export default function RiderDashboardScreen({
  riderId,
  onNavigate,
  onLogout
}) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [rider, setRider] = useState(null);
  const [trip, setTrip] = useState(null);
  const [paymentReady, setPaymentReady] = useState(false);
  const [backendMessage, setBackendMessage] = useState("");

  const fetchDashboard = useCallback(async () => {
    if (!riderId) {
      setBackendMessage("No rider ID was provided.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const riderRes = await fetch(`${API_BASE_URL}/api/riders/${encodeURIComponent(riderId)}`);
      const riderData = await riderRes.json().catch(() => null);

      if (!riderRes.ok) {
        throw new Error(
          riderData?.error || riderData?.message || "Unable to load rider account."
        );
      }

      setRider(riderData?.rider || riderData || null);

      try {
        const tripRes = await fetch(
          `${API_BASE_URL}/api/riders/${encodeURIComponent(riderId)}/active-trip`
        );
        const tripData = await tripRes.json().catch(() => null);

        if (tripRes.ok) {
          setTrip(tripData?.trip || tripData || null);
        } else {
          setTrip(null);
        }
      } catch {
        setTrip(null);
      }

      try {
        const paymentRes = await fetch(
          `${API_BASE_URL}/api/riders/${encodeURIComponent(riderId)}/payment-status`
        );
        const paymentData = await paymentRes.json().catch(() => null);

        if (paymentRes.ok) {
          setPaymentReady(Boolean(paymentData?.paymentReady || paymentData?.authorized));
        } else {
          setPaymentReady(Boolean(riderData?.rider?.payment_ready || riderData?.payment_ready));
        }
      } catch {
        setPaymentReady(Boolean(riderData?.rider?.payment_ready || riderData?.payment_ready));
      }

      setBackendMessage("");
    } catch (error) {
      setBackendMessage(error.message || "Unable to load rider dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [riderId]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDashboard();
  }, [fetchDashboard]);

  const approvalStatus = useMemo(() => {
    const raw =
      rider?.approval_status ||
      rider?.status ||
      rider?.verification_status ||
      "pending";

    return String(raw).toLowerCase();
  }, [rider]);

  const approvalText = useMemo(() => {
    if (approvalStatus === "approved") return "Approved for ride access";
    if (approvalStatus === "rejected") return "Account review requires attention";
    if (approvalStatus === "suspended") return "Account temporarily unavailable";
    return "Pending rider approval";
  }, [approvalStatus]);

  const tripStatusText = useMemo(() => {
    if (!trip) return "No active ride right now.";
    return (
      trip.status ||
      trip.trip_status ||
      trip.ride_status ||
      "Active ride in progress"
    );
  }, [trip]);

  const canRequestRide = approvalStatus === "approved" && paymentReady;

  const handleRequestRide = () => {
    if (approvalStatus !== "approved") {
      Alert.alert(
        "Approval Required",
        "Your rider account must be approved before you can request a ride."
      );
      return;
    }

    if (!paymentReady) {
      Alert.alert(
        "Payment Required",
        "Please complete payment authorization before requesting a ride."
      );
      return;
    }

    if (onNavigate) {
      onNavigate("requestRide", { riderId, rider });
    }
  };

  const handleEditProfile = () => {
    if (onNavigate) {
      onNavigate("editRiderProfile", { riderId, rider });
    } else {
      Alert.alert("Edit Profile", "Connect this button to your profile edit screen.");
    }
  };

  const handleViewTrip = () => {
    if (!trip) {
      Alert.alert("No Active Trip", "There is no active rider trip to view right now.");
      return;
    }

    if (onNavigate) {
      onNavigate("activeTrip", { riderId, rider, trip });
    }
  };

  const handlePayment = () => {
    if (onNavigate) {
      onNavigate("paymentAuthorization", { riderId, rider });
    } else {
      Alert.alert("Payment", "Connect this button to your payment authorization screen.");
    }
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Do you want to sign out of Harvey Taxi?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: () => {
          if (onLogout) onLogout();
        }
      }
    ]);
  };

  const riderName =
    rider?.first_name ||
    rider?.firstName ||
    rider?.name ||
    rider?.full_name ||
    "Rider";

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#69e7ff" />
          <Text style={styles.loadingText}>Loading rider dashboard...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#69e7ff" />
        }
      >
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>HARVEY TAXI MOBILE</Text>
          <Text style={styles.heroTitle}>Rider Command Center</Text>
          <Text style={styles.heroSubtitle}>
            Welcome back, {riderName}. Your profile, approval, trip access, and payment readiness
            are all managed here.
          </Text>

          <View style={styles.heroBadgeRow}>
            <View
              style={[
                styles.statusPill,
                approvalStatus === "approved"
                  ? styles.pillApproved
                  : approvalStatus === "rejected" || approvalStatus === "suspended"
                  ? styles.pillAlert
                  : styles.pillPending
              ]}
            >
              <Text style={styles.statusPillText}>{approvalText}</Text>
            </View>

            <View style={[styles.statusPill, paymentReady ? styles.pillApproved : styles.pillPending]}>
              <Text style={styles.statusPillText}>
                {paymentReady ? "Payment Ready" : "Payment Not Ready"}
              </Text>
            </View>
          </View>
        </View>

        {backendMessage ? (
          <View style={styles.alertCard}>
            <Text style={styles.alertTitle}>Dashboard Notice</Text>
            <Text style={styles.alertText}>{backendMessage}</Text>
          </View>
        ) : null}

        <View style={styles.grid}>
          <View style={styles.cardLarge}>
            <Text style={styles.cardLabel}>Rider Approval Status</Text>
            <Text style={styles.bigValue}>
              {approvalStatus.charAt(0).toUpperCase() + approvalStatus.slice(1)}
            </Text>
            <Text style={styles.cardCopy}>
              Riders must be approved before requesting a mission under current Harvey Taxi rules.
            </Text>
          </View>

          <View style={styles.cardLarge}>
            <Text style={styles.cardLabel}>Payment Access</Text>
            <Text style={styles.bigValue}>{paymentReady ? "Authorized" : "Needed"}</Text>
            <Text style={styles.cardCopy}>
              Payment authorization must be active before dispatch can begin.
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Active Trip Status</Text>
          <Text style={styles.tripStatus}>{tripStatusText}</Text>

          {trip ? (
            <View style={styles.tripDetails}>
              <View style={styles.tripRow}>
                <Text style={styles.tripKey}>Pickup</Text>
                <Text style={styles.tripValue}>
                  {trip.pickup_address || trip.pickupAddress || "Pending pickup address"}
                </Text>
              </View>

              <View style={styles.tripRow}>
                <Text style={styles.tripKey}>Dropoff</Text>
                <Text style={styles.tripValue}>
                  {trip.dropoff_address || trip.dropoffAddress || "Pending dropoff address"}
                </Text>
              </View>

              <View style={styles.tripRow}>
                <Text style={styles.tripKey}>Driver</Text>
                <Text style={styles.tripValue}>
                  {trip.driver_name || trip.driverName || "Driver assignment pending"}
                </Text>
              </View>

              <View style={styles.tripRow}>
                <Text style={styles.tripKey}>Fare</Text>
                <Text style={styles.tripValue}>
                  {trip.fare_total
                    ? `$${Number(trip.fare_total).toFixed(2)}`
                    : trip.estimated_fare
                    ? `$${Number(trip.estimated_fare).toFixed(2)}`
                    : "Estimate pending"}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={styles.cardCopy}>
              No ride is currently active. Once a trip is created, the latest mission status will
              appear here.
            </Text>
          )}

          <TouchableOpacity style={styles.secondaryButton} onPress={handleViewTrip}>
            <Text style={styles.secondaryButtonText}>View Active Trip</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Rider Profile</Text>

          <View style={styles.profileRow}>
            <Text style={styles.profileKey}>Name</Text>
            <Text style={styles.profileValue}>
              {rider?.first_name || rider?.firstName || ""} {rider?.last_name || rider?.lastName || ""}
            </Text>
          </View>

          <View style={styles.profileRow}>
            <Text style={styles.profileKey}>Phone</Text>
            <Text style={styles.profileValue}>{rider?.phone || rider?.phone_number || "Not added"}</Text>
          </View>

          <View style={styles.profileRow}>
            <Text style={styles.profileKey}>Email</Text>
            <Text style={styles.profileValue}>{rider?.email || "Not added"}</Text>
          </View>

          <View style={styles.profileRow}>
            <Text style={styles.profileKey}>ID Type</Text>
            <Text style={styles.profileValue}>
              {rider?.id_type || rider?.government_id_type || "Not listed"}
            </Text>
          </View>

          <View style={styles.profileRow}>
            <Text style={styles.profileKey}>Emergency Contact</Text>
            <Text style={styles.profileValue}>
              {rider?.emergency_contact || rider?.emergencyContact || "Not added"}
            </Text>
          </View>

          <View style={styles.profileRow}>
            <Text style={styles.profileKey}>Notes</Text>
            <Text style={styles.profileValue}>{rider?.notes || rider?.account_notes || "None"}</Text>
          </View>

          <TouchableOpacity style={styles.secondaryButton} onPress={handleEditProfile}>
            <Text style={styles.secondaryButtonText}>Edit Rider Profile</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actionsWrap}>
          <TouchableOpacity
            style={[styles.primaryButton, !canRequestRide && styles.disabledButton]}
            onPress={handleRequestRide}
          >
            <Text style={styles.primaryButtonText}>Request Ride</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryActionButton} onPress={handlePayment}>
            <Text style={styles.secondaryActionText}>
              {paymentReady ? "Manage Payment" : "Authorize Payment"}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
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
    paddingBottom: 36,
    backgroundColor: "#020817"
  },
  loadingWrap: {
    flex: 1,
    backgroundColor: "#020817",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24
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
    marginBottom: 18,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 14 }
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
    lineHeight: 22,
    marginBottom: 18
  },
  heroBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  statusPill: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1
  },
  pillApproved: {
    backgroundColor: "rgba(52,211,153,0.15)",
    borderColor: "rgba(52,211,153,0.35)"
  },
  pillPending: {
    backgroundColor: "rgba(250,204,21,0.14)",
    borderColor: "rgba(250,204,21,0.30)"
  },
  pillAlert: {
    backgroundColor: "rgba(244,63,94,0.14)",
    borderColor: "rgba(244,63,94,0.30)"
  },
  statusPillText: {
    color: "#ecf4ff",
    fontWeight: "800",
    fontSize: 13
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
  grid: {
    gap: 14,
    marginBottom: 18
  },
  cardLarge: {
    backgroundColor: "rgba(8,16,38,0.95)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(110,170,255,0.16)",
    padding: 20
  },
  card: {
    backgroundColor: "rgba(8,16,38,0.95)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(110,170,255,0.16)",
    padding: 20,
    marginBottom: 18
  },
  cardLabel: {
    color: "#9bb3e8",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8
  },
  bigValue: {
    color: "#f8fbff",
    fontSize: 28,
    fontWeight: "900",
    marginBottom: 10
  },
  cardCopy: {
    color: "#b9c8ef",
    fontSize: 15,
    lineHeight: 22
  },
  sectionTitle: {
    color: "#f7fbff",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 12
  },
  tripStatus: {
    color: "#69e7ff",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 14
  },
  tripDetails: {
    gap: 12,
    marginBottom: 18
  },
  tripRow: {
    backgroundColor: "rgba(18,29,63,0.7)",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(110,170,255,0.12)"
  },
  tripKey: {
    color: "#8ea6db",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4
  },
  tripValue: {
    color: "#f4f8ff",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21
  },
  profileRow: {
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(111,170,255,0.10)"
  },
  profileKey: {
    color: "#8ea6db",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4
  },
  profileValue: {
    color: "#f4f8ff",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21
  },
  actionsWrap: {
    gap: 14,
    marginBottom: 18
  },
  primaryButton: {
    backgroundColor: "#63dfff",
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center"
  },
  disabledButton: {
    opacity: 0.45
  },
  primaryButtonText: {
    color: "#06111f",
    fontSize: 18,
    fontWeight: "900"
  },
  secondaryButton: {
    marginTop: 8,
    backgroundColor: "rgba(90,130,255,0.12)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(110,170,255,0.20)",
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryButtonText: {
    color: "#d8e7ff",
    fontSize: 16,
    fontWeight: "800"
  },
  secondaryActionButton: {
    backgroundColor: "rgba(97,247,255,0.10)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(99,245,255,0.25)",
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryActionText: {
    color: "#dffcff",
    fontSize: 17,
    fontWeight: "800"
  },
  logoutButton: {
    backgroundColor: "rgba(255,93,122,0.10)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,93,122,0.22)",
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  logoutText: {
    color: "#ffd9e0",
    fontSize: 16,
    fontWeight: "900"
  }
});
