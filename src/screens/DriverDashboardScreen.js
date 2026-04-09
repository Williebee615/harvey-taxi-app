import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View
} from "react-native";

const API_BASE_URL = "https://harvey-taxi-app-2.onrender.com";

export default function DriverDashboardScreen({
  driverId,
  onNavigate,
  onLogout
}) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingAvailability, setUpdatingAvailability] = useState(false);

  const [driver, setDriver] = useState(null);
  const [mission, setMission] = useState(null);
  const [availability, setAvailability] = useState(false);
  const [backendMessage, setBackendMessage] = useState("");

  const fetchDashboard = useCallback(async () => {
    if (!driverId) {
      setBackendMessage("No driver ID was provided.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const driverRes = await fetch(`${API_BASE_URL}/api/drivers/${encodeURIComponent(driverId)}`);
      const driverData = await driverRes.json().catch(() => null);

      if (!driverRes.ok) {
        throw new Error(driverData?.error || driverData?.message || "Unable to load driver account.");
      }

      const driverRecord = driverData?.driver || driverData || {};
      setDriver(driverRecord);
      setAvailability(Boolean(
        driverRecord.is_available ??
        driverRecord.available ??
        driverRecord.availability ??
        false
      ));

      try {
        const missionRes = await fetch(
          `${API_BASE_URL}/api/drivers/${encodeURIComponent(driverId)}/current-mission`
        );
        const missionData = await missionRes.json().catch(() => null);

        if (missionRes.ok) {
          setMission(missionData?.mission || missionData || null);
        } else {
          setMission(null);
        }
      } catch {
        setMission(null);
      }

      setBackendMessage("");
    } catch (error) {
      setBackendMessage(error.message || "Unable to load driver dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [driverId]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDashboard();
  }, [fetchDashboard]);

  const approvalStatus = useMemo(() => {
    const raw =
      driver?.approval_status ||
      driver?.status ||
      driver?.verification_status ||
      "pending";

    return String(raw).toLowerCase();
  }, [driver]);

  const approvalText = useMemo(() => {
    if (approvalStatus === "approved") return "Approved to accept missions";
    if (approvalStatus === "rejected") return "Driver review requires attention";
    if (approvalStatus === "suspended") return "Driver access suspended";
    return "Pending driver approval";
  }, [approvalStatus]);

  const handleAvailabilityToggle = async (value) => {
    if (approvalStatus !== "approved") {
      Alert.alert(
        "Approval Required",
        "Your driver profile must be approved before you can go online."
      );
      return;
    }

    try {
      setUpdatingAvailability(true);
      setAvailability(value);

      const response = await fetch(
        `${API_BASE_URL}/api/driver/${encodeURIComponent(driverId)}/availability`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ available: value })
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || data?.message || "Unable to update driver availability.");
      }

      setBackendMessage(value ? "You are now online for dispatch." : "You are now offline.");
    } catch (error) {
      setAvailability(!value);
      setBackendMessage(error.message || "Unable to update driver availability.");
    } finally {
      setUpdatingAvailability(false);
    }
  };

  const handleMissionCenter = () => {
    if (onNavigate) {
      onNavigate("missionCenter", { driverId, driver, mission });
    } else {
      Alert.alert("Mission Center", "Connect this button to your driver mission screen.");
    }
  };

  const handleTripTools = () => {
    if (onNavigate) {
      onNavigate("driverTripTools", { driverId, driver, mission });
    } else {
      Alert.alert("Trip Tools", "Connect this button to your active driver tools screen.");
    }
  };

  const handleEditProfile = () => {
    if (onNavigate) {
      onNavigate("editDriverProfile", { driverId, driver });
    } else {
      Alert.alert("Edit Profile", "Connect this button to your driver profile screen.");
    }
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Do you want to sign out of Harvey Taxi Driver?", [
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

  const driverName =
    driver?.first_name ||
    driver?.firstName ||
    driver?.name ||
    driver?.full_name ||
    "Driver";

  const vehicleText =
    driver?.vehicle_make && driver?.vehicle_model
      ? `${driver.vehicle_make} ${driver.vehicle_model}`
      : driver?.vehicle || "Vehicle not added";

  const payoutText =
    mission?.driver_payout || mission?.payout
      ? `$${Number(mission?.driver_payout || mission?.payout).toFixed(2)}`
      : "Pending";

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#69e7ff" />
          <Text style={styles.loadingText}>Loading driver dashboard...</Text>
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
          <Text style={styles.eyebrow}>HARVEY TAXI DRIVER</Text>
          <Text style={styles.heroTitle}>Driver Command Center</Text>
          <Text style={styles.heroSubtitle}>
            Welcome back, {driverName}. Manage your approval, availability, mission access, and
            live driver operations from here.
          </Text>

          <View style={styles.badgeWrap}>
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

            <View style={[styles.statusPill, availability ? styles.pillApproved : styles.pillPending]}>
              <Text style={styles.statusPillText}>
                {availability ? "Online for Dispatch" : "Offline"}
              </Text>
            </View>
          </View>
        </View>

        {backendMessage ? (
          <View style={styles.alertCard}>
            <Text style={styles.alertTitle}>Driver Notice</Text>
            <Text style={styles.alertText}>{backendMessage}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Availability Control</Text>

          <View style={styles.availabilityRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.availabilityTitle}>
                {availability ? "Driver is Online" : "Driver is Offline"}
              </Text>
              <Text style={styles.availabilityText}>
                Turn availability on when you are ready to receive Harvey Taxi mission offers.
              </Text>
            </View>

            <Switch
              value={availability}
              onValueChange={handleAvailabilityToggle}
              disabled={updatingAvailability}
              trackColor={{ false: "#32405f", true: "#58dbff" }}
              thumbColor={availability ? "#e9fbff" : "#d8e0ff"}
            />
          </View>
        </View>

        <View style={styles.grid}>
          <View style={styles.cardLarge}>
            <Text style={styles.cardLabel}>Driver Approval</Text>
            <Text style={styles.bigValue}>
              {approvalStatus.charAt(0).toUpperCase() + approvalStatus.slice(1)}
            </Text>
            <Text style={styles.cardCopy}>
              Only approved drivers can go online and receive dispatch offers.
            </Text>
          </View>

          <View style={styles.cardLarge}>
            <Text style={styles.cardLabel}>Vehicle Status</Text>
            <Text style={styles.bigValueSmall}>{vehicleText}</Text>
            <Text style={styles.cardCopy}>
              Keep your vehicle details current for rider trust and admin review.
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Mission Package</Text>

          {mission ? (
            <>
              <Text style={styles.tripStatus}>
                {mission.status || mission.mission_status || "Mission available"}
              </Text>

              <View style={styles.tripDetails}>
                <View style={styles.tripRow}>
                  <Text style={styles.tripKey}>Pickup</Text>
                  <Text style={styles.tripValue}>
                    {mission.pickup_address || mission.pickupAddress || "Pending pickup"}
                  </Text>
                </View>

                <View style={styles.tripRow}>
                  <Text style={styles.tripKey}>Dropoff</Text>
                  <Text style={styles.tripValue}>
                    {mission.dropoff_address || mission.dropoffAddress || "Pending dropoff"}
                  </Text>
                </View>

                <View style={styles.tripRow}>
                  <Text style={styles.tripKey}>Rider</Text>
                  <Text style={styles.tripValue}>
                    {mission.rider_name || mission.riderName || "Rider assigned"}
                  </Text>
                </View>

                <View style={styles.tripRow}>
                  <Text style={styles.tripKey}>Driver Payout</Text>
                  <Text style={styles.tripValue}>{payoutText}</Text>
                </View>
              </View>
            </>
          ) : (
            <Text style={styles.cardCopy}>
              No active mission right now. Once dispatch assigns a mission, the full package will
              appear here before and during trip handling.
            </Text>
          )}

          <TouchableOpacity style={styles.secondaryButton} onPress={handleMissionCenter}>
            <Text style={styles.secondaryButtonText}>Open Mission Center</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Driver Profile</Text>

          <View style={styles.profileRow}>
            <Text style={styles.profileKey}>Name</Text>
            <Text style={styles.profileValue}>
              {driver?.first_name || driver?.firstName || ""} {driver?.last_name || driver?.lastName || ""}
            </Text>
          </View>

          <View style={styles.profileRow}>
            <Text style={styles.profileKey}>Phone</Text>
            <Text style={styles.profileValue}>{driver?.phone || driver?.phone_number || "Not added"}</Text>
          </View>

          <View style={styles.profileRow}>
            <Text style={styles.profileKey}>Email</Text>
            <Text style={styles.profileValue}>{driver?.email || "Not added"}</Text>
          </View>

          <View style={styles.profileRow}>
            <Text style={styles.profileKey}>Vehicle</Text>
            <Text style={styles.profileValue}>{vehicleText}</Text>
          </View>

          <View style={styles.profileRow}>
            <Text style={styles.profileKey}>License / Verification</Text>
            <Text style={styles.profileValue}>
              {driver?.license_status || driver?.verification_status || "Pending"}
            </Text>
          </View>

          <TouchableOpacity style={styles.secondaryButton} onPress={handleEditProfile}>
            <Text style={styles.secondaryButtonText}>Edit Driver Profile</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actionsWrap}>
          <TouchableOpacity style={styles.primaryButton} onPress={handleMissionCenter}>
            <Text style={styles.primaryButtonText}>Mission Center</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryActionButton} onPress={handleTripTools}>
            <Text style={styles.secondaryActionText}>Trip Tools</Text>
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
    lineHeight: 22,
    marginBottom: 18
  },
  badgeWrap: {
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
  card: {
    backgroundColor: "rgba(8,16,38,0.95)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(110,170,255,0.16)",
    padding: 20,
    marginBottom: 18
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
  sectionTitle: {
    color: "#f7fbff",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 12
  },
  availabilityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18
  },
  availabilityTitle: {
    color: "#f5f9ff",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6
  },
  availabilityText: {
    color: "#b9c8ef",
    fontSize: 15,
    lineHeight: 22
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
  bigValueSmall: {
    color: "#f8fbff",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 10
  },
  cardCopy: {
    color: "#b9c8ef",
    fontSize: 15,
    lineHeight: 22
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
