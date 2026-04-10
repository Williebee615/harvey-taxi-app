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

function normalizeMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Pending";
  return `$${amount.toFixed(2)}`;
}

function formatStatus(value, fallback = "Pending") {
  const raw = String(value || fallback).trim();
  if (!raw) return fallback;

  return raw
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getDriverName(driver) {
  if (!driver) return "Driver";

  const first =
    driver.first_name ||
    driver.firstName ||
    driver.given_name ||
    "";

  const last =
    driver.last_name ||
    driver.lastName ||
    driver.family_name ||
    "";

  const full = `${first} ${last}`.trim();

  return (
    full ||
    driver.full_name ||
    driver.name ||
    "Driver"
  );
}

function getVehicleText(driver) {
  if (!driver) return "Vehicle not added";

  const year = driver.vehicle_year || driver.vehicleYear || "";
  const make = driver.vehicle_make || driver.vehicleMake || "";
  const model = driver.vehicle_model || driver.vehicleModel || "";
  const plate = driver.plate || driver.license_plate || driver.licensePlate || "";

  const primary = [year, make, model].filter(Boolean).join(" ").trim();

  if (primary && plate) return `${primary} • ${plate}`;
  if (primary) return primary;
  if (plate) return plate;
  return driver.vehicle || "Vehicle not added";
}

function getApprovalStatus(driver) {
  const raw =
    driver?.approval_status ||
    driver?.status ||
    driver?.verification_status ||
    "pending";

  return String(raw).trim().toLowerCase();
}

function getAvailabilityValue(driver) {
  return Boolean(
    driver?.is_available ??
      driver?.available ??
      driver?.availability ??
      driver?.isOnline ??
      false
  );
}

async function parseJson(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await parseJson(response);

  if (!response.ok) {
    throw new Error(
      data?.error ||
        data?.message ||
        `Request failed with status ${response.status}.`
    );
  }

  return data;
}

function StatTile({ label, value, helper }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statHelper}>{helper}</Text>
    </View>
  );
}

function DetailRow({ label, value, last = false }) {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || "Not available"}</Text>
    </View>
  );
}

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
      setDriver(null);
      setMission(null);
      setAvailability(false);
      setBackendMessage("No driver ID was provided.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const driverData = await fetchJson(
        `/api/drivers/${encodeURIComponent(driverId)}`,
        { method: "GET" }
      );

      const driverRecord = driverData?.driver || driverData || {};
      setDriver(driverRecord);
      setAvailability(getAvailabilityValue(driverRecord));

      try {
        const missionData = await fetchJson(
          `/api/drivers/${encodeURIComponent(driverId)}/current-mission`,
          { method: "GET" }
        );

        setMission(missionData?.mission || missionData || null);
      } catch {
        setMission(null);
      }

      setBackendMessage("");
    } catch (error) {
      setDriver(null);
      setMission(null);
      setAvailability(false);
      setBackendMessage(
        error?.message || "Unable to load driver dashboard."
      );
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

  const approvalStatus = useMemo(() => getApprovalStatus(driver), [driver]);

  const approvalText = useMemo(() => {
    if (approvalStatus === "approved") return "Approved to accept missions";
    if (approvalStatus === "rejected") return "Driver review requires attention";
    if (approvalStatus === "suspended") return "Driver access suspended";
    if (approvalStatus === "partially_verified") return "Partially verified";
    return "Pending driver approval";
  }, [approvalStatus]);

  const approvalToneStyle = useMemo(() => {
    if (approvalStatus === "approved") return styles.pillApproved;
    if (approvalStatus === "rejected" || approvalStatus === "suspended") {
      return styles.pillAlert;
    }
    return styles.pillPending;
  }, [approvalStatus]);

  const driverName = useMemo(() => getDriverName(driver), [driver]);
  const vehicleText = useMemo(() => getVehicleText(driver), [driver]);

  const missionStatusText = useMemo(() => {
    return formatStatus(mission?.status || mission?.mission_status || "Awaiting assignment");
  }, [mission]);

  const payoutText = useMemo(() => {
    return normalizeMoney(mission?.driver_payout || mission?.payout);
  }, [mission]);

  const onlineLabel = availability ? "Online for Dispatch" : "Offline";

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

      const data = await fetchJson(
        `/api/driver/${encodeURIComponent(driverId)}/availability`,
        {
          method: "PATCH",
          body: JSON.stringify({ available: value })
        }
      );

      const updatedDriver = data?.driver || data?.data || null;

      if (updatedDriver && typeof updatedDriver === "object") {
        setDriver((current) => ({
          ...(current || {}),
          ...updatedDriver
        }));
        setAvailability(getAvailabilityValue(updatedDriver));
      }

      setBackendMessage(
        value
          ? "You are now online for dispatch."
          : "You are now offline."
      );
    } catch (error) {
      setAvailability((previous) => !value);
      setBackendMessage(
        error?.message || "Unable to update driver availability."
      );
    } finally {
      setUpdatingAvailability(false);
    }
  };

  const handleMissionCenter = () => {
    if (onNavigate) {
      onNavigate("missionCenter", { driverId, driver, mission });
      return;
    }

    Alert.alert(
      "Mission Center",
      "Connect this button to your driver mission screen."
    );
  };

  const handleTripTools = () => {
    if (onNavigate) {
      onNavigate("driverTripTools", { driverId, driver, mission });
      return;
    }

    Alert.alert(
      "Trip Tools",
      "Connect this button to your active driver tools screen."
    );
  };

  const handleEditProfile = () => {
    if (onNavigate) {
      onNavigate("editDriverProfile", { driverId, driver });
      return;
    }

    Alert.alert(
      "Edit Profile",
      "Connect this button to your driver profile screen."
    );
  };

  const handleGoHome = () => {
    if (onNavigate) {
      onNavigate("home");
      return;
    }

    Alert.alert("Home", "Connect this button to your home screen.");
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

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingWrap}>
          <View style={styles.loadingOrb} />
          <ActivityIndicator size="large" color="#69e7ff" />
          <Text style={styles.loadingText}>Loading driver dashboard...</Text>
          <Text style={styles.loadingSubtext}>
            Syncing your Harvey Taxi driver profile, availability, and mission status.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#69e7ff"
          />
        }
      >
        <View pointerEvents="none" style={styles.heroGlow} />

        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>HARVEY TAXI DRIVER</Text>
          <Text style={styles.heroTitle}>Driver Command Center</Text>
          <Text style={styles.heroSubtitle}>
            Welcome back, {driverName}. Manage approval, availability, missions,
            and live operations from one launch-ready dashboard.
          </Text>

          <View style={styles.badgeWrap}>
            <View style={[styles.statusPill, approvalToneStyle]}>
              <Text style={styles.statusPillText}>{approvalText}</Text>
            </View>

            <View
              style={[
                styles.statusPill,
                availability ? styles.pillApproved : styles.pillPending
              ]}
            >
              <Text style={styles.statusPillText}>{onlineLabel}</Text>
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
            <View style={styles.availabilityCopyWrap}>
              <Text style={styles.availabilityTitle}>
                {availability ? "Driver is Online" : "Driver is Offline"}
              </Text>
              <Text style={styles.availabilityText}>
                Turn availability on when you are ready to receive Harvey Taxi
                mission offers. Approval is required before dispatch can begin.
              </Text>
            </View>

            <View style={styles.switchWrap}>
              <Switch
                value={availability}
                onValueChange={handleAvailabilityToggle}
                disabled={updatingAvailability}
                trackColor={{ false: "#32405f", true: "#58dbff" }}
                thumbColor={availability ? "#e9fbff" : "#d8e0ff"}
              />
              {updatingAvailability ? (
                <ActivityIndicator
                  size="small"
                  color="#69e7ff"
                  style={styles.switchLoader}
                />
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <StatTile
            label="Driver Approval"
            value={formatStatus(approvalStatus)}
            helper="Only approved drivers can go online and receive offers."
          />
          <StatTile
            label="Vehicle Status"
            value={vehicleText}
            helper="Keep your vehicle details current for trust and review."
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Mission Package</Text>

          {mission ? (
            <>
              <View style={styles.missionHeaderRow}>
                <Text style={styles.tripStatus}>{missionStatusText}</Text>
                <View style={styles.missionMiniPill}>
                  <Text style={styles.missionMiniPillText}>{payoutText}</Text>
                </View>
              </View>

              <View style={styles.tripDetails}>
                <View style={styles.tripRow}>
                  <Text style={styles.tripKey}>Pickup</Text>
                  <Text style={styles.tripValue}>
                    {mission.pickup_address ||
                      mission.pickupAddress ||
                      "Pending pickup"}
                  </Text>
                </View>

                <View style={styles.tripRow}>
                  <Text style={styles.tripKey}>Dropoff</Text>
                  <Text style={styles.tripValue}>
                    {mission.dropoff_address ||
                      mission.dropoffAddress ||
                      "Pending dropoff"}
                  </Text>
                </View>

                <View style={styles.tripRow}>
                  <Text style={styles.tripKey}>Rider</Text>
                  <Text style={styles.tripValue}>
                    {mission.rider_name ||
                      mission.riderName ||
                      "Rider assigned"}
                  </Text>
                </View>

                <View style={styles.tripRow}>
                  <Text style={styles.tripKey}>Driver Payout</Text>
                  <Text style={styles.tripValue}>{payoutText}</Text>
                </View>

                <View style={styles.tripRow}>
                  <Text style={styles.tripKey}>Notes</Text>
                  <Text style={styles.tripValue}>
                    {mission.notes ||
                      mission.special_notes ||
                      mission.specialInstructions ||
                      "No special trip notes."}
                  </Text>
                </View>
              </View>
            </>
          ) : (
            <Text style={styles.cardCopy}>
              No active mission right now. Once dispatch assigns a mission, the
              full package will appear here before and during trip handling.
            </Text>
          )}

          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.secondaryButton}
            onPress={handleMissionCenter}
          >
            <Text style={styles.secondaryButtonText}>Open Mission Center</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Driver Profile</Text>

          <DetailRow label="Name" value={driverName} />
          <DetailRow
            label="Phone"
            value={driver?.phone || driver?.phone_number || "Not added"}
          />
          <DetailRow
            label="Email"
            value={driver?.email || "Not added"}
          />
          <DetailRow
            label="Vehicle"
            value={vehicleText}
          />
          <DetailRow
            label="License / Verification"
            value={formatStatus(
              driver?.license_status || driver?.verification_status || "pending"
            )}
            last
          />

          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.secondaryButton}
            onPress={handleEditProfile}
          >
            <Text style={styles.secondaryButtonText}>Edit Driver Profile</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actionsWrap}>
          <TouchableOpacity
            activeOpacity={0.92}
            style={styles.primaryButton}
            onPress={handleMissionCenter}
          >
            <Text style={styles.primaryButtonText}>Mission Center</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.92}
            style={styles.secondaryActionButton}
            onPress={handleTripTools}
          >
            <Text style={styles.secondaryActionText}>Trip Tools</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.92}
            style={styles.homeButton}
            onPress={handleGoHome}
          >
            <Text style={styles.homeButtonText}>Return Home</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={0.9}
          style={styles.logoutButton}
          onPress={handleLogout}
        >
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
    paddingBottom: 40,
    backgroundColor: "#020817"
  },

  loadingWrap: {
    flex: 1,
    backgroundColor: "#020817",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24
  },

  loadingOrb: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(99,223,255,0.07)"
  },

  loadingText: {
    marginTop: 14,
    color: "#c8d5ff",
    fontSize: 16,
    fontWeight: "700"
  },

  loadingSubtext: {
    marginTop: 8,
    color: "#8fa6d8",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 280
  },

  heroGlow: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    height: 240,
    borderRadius: 40,
    backgroundColor: "rgba(95, 227, 255, 0.05)"
  },

  heroCard: {
    backgroundColor: "rgba(10,18,42,0.96)",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(99,196,255,0.20)",
    padding: 22,
    marginBottom: 18,
    overflow: "hidden"
  },

  eyebrow: {
    color: "#6ee7ff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
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
    backgroundColor: "rgba(40,17,34,0.90)",
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
    backgroundColor: "rgba(8,16,38,0.96)",
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
    marginBottom: 12
  },

  availabilityRow: {
    flexDirection: "row",
    alignItems: "center"
  },

  availabilityCopyWrap: {
    flex: 1,
    paddingRight: 12
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

  switchWrap: {
    minWidth: 62,
    alignItems: "center",
    justifyContent: "center"
  },

  switchLoader: {
    marginTop: 8
  },

  statsGrid: {
    gap: 14,
    marginBottom: 18
  },

  statTile: {
    backgroundColor: "rgba(8,16,38,0.96)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(110,170,255,0.16)",
    padding: 20
  },

  statLabel: {
    color: "#9bb3e8",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8
  },

  statValue: {
    color: "#f8fbff",
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 10
  },

  statHelper: {
    color: "#b9c8ef",
    fontSize: 15,
    lineHeight: 22
  },

  missionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14
  },

  tripStatus: {
    color: "#69e7ff",
    fontSize: 18,
    fontWeight: "800",
    flex: 1
  },

  missionMiniPill: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(99,223,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(99,223,255,0.20)"
  },

  missionMiniPillText: {
    color: "#dffcff",
    fontSize: 13,
    fontWeight: "800"
  },

  tripDetails: {
    gap: 12,
    marginBottom: 18
  },

  tripRow: {
    backgroundColor: "rgba(18,29,63,0.72)",
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

  cardCopy: {
    color: "#b9c8ef",
    fontSize: 15,
    lineHeight: 22
  },

  detailRow: {
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(111,170,255,0.10)"
  },

  detailRowLast: {
    marginBottom: 4
  },

  detailLabel: {
    color: "#8ea6db",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4
  },

  detailValue: {
    color: "#f4f8ff",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21
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

  homeButton: {
    backgroundColor: "rgba(120,134,255,0.10)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(120,134,255,0.24)",
    paddingVertical: 17,
    alignItems: "center",
    justifyContent: "center"
  },

  homeButtonText: {
    color: "#e5eaff",
    fontSize: 16,
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
