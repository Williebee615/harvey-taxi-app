import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { askHarveyAI } from "../config/api";

function HarveyAiChat({ visible, onClose, pageContext = "homepage" }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text:
        "Welcome to Harvey AI Support. I can help with rides, rider signup, driver onboarding, Harvey Taxi Service LLC, the nonprofit mission, and autonomous pilot questions."
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const canSend = useMemo(() => {
    return input.trim().length > 0 && !loading;
  }, [input, loading]);

  async function sendMessage(prefilledMessage) {
    const text = String(prefilledMessage || input).trim();
    if (!text || loading) return;

    setMessages((current) => [
      ...current,
      {
        role: "user",
        text
      }
    ]);
    setInput("");
    setLoading(true);

    try {
      const data = await askHarveyAI({
        message: text,
        pageContext,
        riderId: null,
        driverId: null,
        rideId: null
      });

      const reply =
        data?.ai?.reply ||
        data?.reply ||
        "I’m here to help with Harvey Taxi support.";

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: reply
        }
      ]);
    } catch (error) {
      const actualError = error?.message || "Unknown AI connection error.";

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: `AI request failed: ${actualError}`
        }
      ]);

      console.log("Harvey AI request failed:", actualError);
    } finally {
      setLoading(false);
    }
  }

  function resetChat() {
    setMessages([
      {
        role: "assistant",
        text:
          "Welcome back to Harvey AI Support. Ask me about rides, support, the nonprofit mission, or autonomous pilot flow."
      }
    ]);
    setInput("");
  }

  const quickPrompts = [
    "How do I request a ride?",
    "How do I sign up as a driver?",
    "What is Harvey Taxi?",
    "What is the nonprofit mission?",
    "Is autonomous service live?"
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.aiOverlay}>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <View style={styles.aiCard}>
            <View style={styles.aiHeader}>
              <View style={styles.aiBrandRow}>
                <View style={styles.aiBadge}>
                  <Text style={styles.aiBadgeText}>AI</Text>
                </View>

                <View style={styles.aiHeaderTextWrap}>
                  <Text style={styles.aiTitle}>Harvey AI Support</Text>
                  <Text style={styles.aiSubtitle}>Home page support</Text>
                </View>
              </View>

              <View style={styles.aiHeaderActions}>
                <TouchableOpacity style={styles.aiHeaderButton} onPress={resetChat}>
                  <Text style={styles.aiHeaderButtonText}>↺</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.aiHeaderButton} onPress={onClose}>
                  <Text style={styles.aiHeaderButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.aiMessagesContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {messages.map((message, index) => (
                <View
                  key={`${message.role}-${index}`}
                  style={[
                    styles.aiMessageWrap,
                    message.role === "user"
                      ? styles.aiMessageWrapUser
                      : styles.aiMessageWrapAssistant
                  ]}
                >
                  <Text
                    style={[
                      styles.aiRoleLabel,
                      message.role === "user"
                        ? styles.aiRoleLabelUser
                        : styles.aiRoleLabelAssistant
                    ]}
                  >
                    {message.role === "user" ? "You" : "Harvey AI Support"}
                  </Text>

                  <View
                    style={[
                      styles.aiBubble,
                      message.role === "user"
                        ? styles.aiBubbleUser
                        : styles.aiBubbleAssistant
                    ]}
                  >
                    <Text
                      style={[
                        styles.aiBubbleText,
                        message.role === "user"
                          ? styles.aiBubbleTextUser
                          : styles.aiBubbleTextAssistant
                      ]}
                    >
                      {message.text}
                    </Text>
                  </View>
                </View>
              ))}

              {loading ? (
                <View style={[styles.aiMessageWrap, styles.aiMessageWrapAssistant]}>
                  <Text style={[styles.aiRoleLabel, styles.aiRoleLabelAssistant]}>
                    Harvey AI Support
                  </Text>

                  <View
                    style={[
                      styles.aiBubble,
                      styles.aiBubbleAssistant,
                      styles.aiTypingBubble
                    ]}
                  >
                    <ActivityIndicator size="small" color="#63f5ff" />
                    <Text style={styles.aiTypingText}>Thinking...</Text>
                  </View>
                </View>
              ) : null}
            </ScrollView>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.aiQuickRow}
              keyboardShouldPersistTaps="handled"
            >
              {quickPrompts.map((prompt) => (
                <TouchableOpacity
                  key={prompt}
                  style={styles.aiQuickButton}
                  onPress={() => sendMessage(prompt)}
                  disabled={loading}
                >
                  <Text style={styles.aiQuickButtonText}>{prompt}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.aiInputRow}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Ask Harvey AI about rides, support, drivers, nonprofit, or autonomous service..."
                placeholderTextColor="#9fb0da"
                multiline
                style={styles.aiInput}
              />

              <TouchableOpacity
                style={[styles.aiSendButton, !canSend && styles.aiSendButtonDisabled]}
                onPress={() => sendMessage()}
                disabled={!canSend}
              >
                <Text style={styles.aiSendButtonText}>➜</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.aiFootnote}>
              Harvey AI can explain platform flow and support guidance. For
              emergencies, contact local emergency services immediately.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function HomeScreen({ onNavigate }) {
  const [chatOpen, setChatOpen] = useState(false);

  function openChat() {
    if (chatOpen) return;
    setChatOpen(true);
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <View style={styles.brandDot} />
            <Text style={styles.brand}>HARVEY TAXI</Text>
          </View>

          <View style={styles.topTabs}>
            <View style={styles.topTab}>
              <Text style={styles.topTabText}>How It{"\n"}Works</Text>
            </View>
            <View style={styles.topTab}>
              <Text style={styles.topTabText}>Safety</Text>
            </View>
            <View style={styles.topTab}>
              <Text style={styles.topTabText}>Services</Text>
            </View>
          </View>

          <Text style={styles.title}>Real Mobility. Real Dispatch. Real Access.</Text>

          <Text style={styles.subtitle}>
            Harvey Taxi connects riders, drivers, and future autonomous fleet
            systems through one intelligent transportation platform.
          </Text>

          <View style={styles.heroPills}>
            <View style={styles.heroPill}>
              <Text style={styles.heroPillText}>Verified access</Text>
            </View>
            <View style={styles.heroPill}>
              <Text style={styles.heroPillText}>Dispatch brain online</Text>
            </View>
            <View style={styles.heroPill}>
              <Text style={styles.heroPillText}>AI support live</Text>
            </View>
          </View>
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Harvey AI Support</Text>
          <Text style={styles.cardText}>
            Get help with rider access, driver onboarding, trip flow, nonprofit
            mission questions, and autonomous pilot guidance.
          </Text>

          <TouchableOpacity style={styles.aiOpenButton} onPress={openChat}>
            <Text style={styles.aiOpenButtonText}>Open AI Support</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <TouchableOpacity style={styles.floatingAiButton} onPress={openChat}>
        <Text style={styles.floatingAiButtonText}>AI</Text>
      </TouchableOpacity>

      {chatOpen ? (
        <HarveyAiChat
          visible={chatOpen}
          onClose={() => setChatOpen(false)}
          pageContext="homepage"
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 120,
    backgroundColor: "#07152d"
  },
  hero: {
    backgroundColor: "#04122a",
    borderRadius: 28,
    padding: 24,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.18)"
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16
  },
  brandDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#63f5ff",
    marginRight: 14
  },
  brand: {
    fontSize: 18,
    letterSpacing: 3,
    fontWeight: "900",
    color: "#f4f7ff"
  },
  topTabs: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 22
  },
  topTab: {
    flex: 1,
    minHeight: 80,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10
  },
  topTabText: {
    color: "#b8c8ef",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    textAlign: "center"
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#ffffff",
    lineHeight: 36,
    marginBottom: 12
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: "#d2ddff"
  },
  heroPills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 18
  },
  heroPill: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.18)",
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  heroPillText: {
    color: "#d9e4ff",
    fontSize: 12,
    fontWeight: "800"
  },
  card: {
    backgroundColor: "rgba(10,17,38,0.92)",
    borderRadius: 24,
    padding: 20,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)"
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#ffffff",
    marginBottom: 10
  },
  cardText: {
    fontSize: 15,
    lineHeight: 24,
    color: "#d2ddff",
    marginBottom: 16
  },
  primaryButton: {
    backgroundColor: "#5ea0ff",
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: "center"
  },
  primaryButtonText: {
    color: "#041224",
    fontSize: 16,
    fontWeight: "900"
  },
  statusRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12
  },
  statusBox: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.18)"
  },
  statusLabel: {
    color: "#b9c9ef",
    fontSize: 13,
    marginBottom: 8,
    fontWeight: "700"
  },
  statusValue: {
    color: "#6dffb3",
    fontSize: 17,
    fontWeight: "900"
  },
  aiOpenButton: {
    backgroundColor: "#63f5ff",
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: "center"
  },
  aiOpenButtonText: {
    color: "#041224",
    fontSize: 16,
    fontWeight: "900"
  },
  floatingAiButton: {
    position: "absolute",
    right: 20,
    bottom: 28,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#63f5ff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#63f5ff",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8
  },
  floatingAiButtonText: {
    color: "#041224",
    fontSize: 19,
    fontWeight: "900"
  },
  aiOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end"
  },
  aiCard: {
    height: "85%",
    backgroundColor: "#081225",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.18)",
    overflow: "hidden"
  },
  aiHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(122,162,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.02)"
  },
  aiBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: 12
  },
  aiBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: "#63f5ff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14
  },
  aiBadgeText: {
    color: "#041224",
    fontSize: 20,
    fontWeight: "900"
  },
  aiHeaderTextWrap: {
    flex: 1
  },
  aiHeaderActions: {
    flexDirection: "row",
    gap: 10
  },
  aiHeaderButton: {
    width: 52,
    height: 52,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)"
  },
  aiHeaderButtonText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 22
  },
  aiTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 24
  },
  aiSubtitle: {
    color: "#c2d2ff",
    fontSize: 14,
    marginTop: 4,
    lineHeight: 20
  },
  aiMessagesContent: {
    padding: 16,
    paddingBottom: 20
  },
  aiMessageWrap: {
    width: "100%",
    marginBottom: 14
  },
  aiMessageWrapUser: {
    alignItems: "flex-end"
  },
  aiMessageWrapAssistant: {
    alignItems: "flex-start"
  },
  aiRoleLabel: {
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6
  },
  aiRoleLabelUser: {
    color: "#c6d3f8"
  },
  aiRoleLabelAssistant: {
    color: "#b7c8ef"
  },
  aiBubble: {
    maxWidth: "90%",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  aiBubbleUser: {
    backgroundColor: "#66a8ff"
  },
  aiBubbleAssistant: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.18)"
  },
  aiBubbleText: {
    fontSize: 17,
    lineHeight: 29
  },
  aiBubbleTextUser: {
    color: "#041224",
    fontWeight: "800"
  },
  aiBubbleTextAssistant: {
    color: "#ffffff",
    fontWeight: "600"
  },
  aiTypingBubble: {
    flexDirection: "row",
    alignItems: "center"
  },
  aiTypingText: {
    color: "#d2ddff",
    fontSize: 15,
    marginLeft: 10,
    fontWeight: "700"
  },
  aiQuickRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(122,162,255,0.10)"
  },
  aiQuickButton: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  aiQuickButtonText: {
    color: "#dce6ff",
    fontSize: 14,
    fontWeight: "900"
  },
  aiInputRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 10
  },
  aiInput: {
    flex: 1,
    minHeight: 60,
    maxHeight: 130,
    backgroundColor: "#091634",
    borderWidth: 2,
    borderColor: "rgba(94,160,255,0.28)",
    borderRadius: 22,
    color: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 14,
    textAlignVertical: "top",
    fontSize: 16,
    lineHeight: 24
  },
  aiSendButton: {
    backgroundColor: "#6dffb3",
    borderRadius: 22,
    width: 74,
    height: 60,
    alignItems: "center",
    justifyContent: "center"
  },
  aiSendButtonDisabled: {
    opacity: 0.5
  },
  aiSendButtonText: {
    color: "#062014",
    fontWeight: "900",
    fontSize: 28
  },
  aiFootnote: {
    color: "#c6d3f8",
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16
  }
});
