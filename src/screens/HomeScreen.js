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
import { API_BASE_URL } from "../config/api";

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

    const nextUserMessage = { role: "user", text };
    const nextMessages = [...messages, nextUserMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/support`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: text,
          pageContext
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "AI support request failed.");
      }

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
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text:
            "I’m having trouble reaching Harvey AI right now. Please try again in a moment."
        }
      ]);
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
    "What is Harvey Taxi?",
    "How do I request a ride?",
    "What is the nonprofit mission?",
    "Is autonomous service live?"
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.aiOverlay}>
        <View style={styles.aiCard}>
          <View style={styles.aiHeader}>
            <View>
              <Text style={styles.aiTitle}>Harvey AI Support</Text>
              <Text style={styles.aiSubtitle}>Homepage support assistant</Text>
            </View>

            <View style={styles.aiHeaderActions}>
              <TouchableOpacity style={styles.aiHeaderButton} onPress={resetChat}>
                <Text style={styles.aiHeaderButtonText}>Reset</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.aiHeaderButton} onPress={onClose}>
                <Text style={styles.aiHeaderButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            style={styles.aiMessages}
            contentContainerStyle={styles.aiMessagesContent}
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
                <View style={[styles.aiBubble, styles.aiBubbleAssistant, styles.aiTypingBubble]}>
                  <ActivityIndicator />
                  <Text style={styles.aiTypingText}>Harvey AI is thinking...</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.aiQuickRow}
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
              placeholder="Ask Harvey AI anything..."
              placeholderTextColor="#8ea2d6"
              multiline
              style={styles.aiInput}
            />

            <TouchableOpacity
              style={[styles.aiSendButton, !canSend && styles.aiSendButtonDisabled]}
              onPress={() => sendMessage()}
              disabled={!canSend}
            >
              <Text style={styles.aiSendButtonText}>Send</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.aiFootnote}>
            Harvey AI can explain platform flow and support guidance. For emergencies,
            contact local emergency services immediately.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

export default function HomeScreen({ onNavigate }) {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <>
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Harvey AI Support</Text>
          <Text style={styles.cardText}>
            Get help with rider access, driver onboarding, trip flow, nonprofit
            mission questions, and autonomous pilot guidance.
          </Text>

          <TouchableOpacity
            style={styles.aiOpenButton}
            onPress={() => setChatOpen(true)}
          >
            <Text style={styles.aiOpenButtonText}>Open AI Support</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <TouchableOpacity
        style={styles.floatingAiButton}
        onPress={() => setChatOpen(true)}
      >
        <Text style={styles.floatingAiButtonText}>AI</Text>
      </TouchableOpacity>

      <HarveyAiChat
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        pageContext="homepage"
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 120,
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
  },
  aiOpenButton: {
    backgroundColor: "#63f5ff",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center"
  },
  aiOpenButtonText: {
    color: "#041224",
    fontSize: 16,
    fontWeight: "800"
  },
  floatingAiButton: {
    position: "absolute",
    right: 20,
    bottom: 28,
    width: 66,
    height: 66,
    borderRadius: 33,
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
    fontSize: 18,
    fontWeight: "900"
  },
  aiOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end"
  },
  aiCard: {
    height: "82%",
    backgroundColor: "#07101f",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)",
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 20
  },
  aiHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 12
  },
  aiHeaderActions: {
    flexDirection: "row",
    gap: 8
  },
  aiHeaderButton: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)"
  },
  aiHeaderButtonText: {
    color: "#f4f7ff",
    fontWeight: "700",
    fontSize: 12
  },
  aiTitle: {
    color: "#f4f7ff",
    fontSize: 18,
    fontWeight: "800"
  },
  aiSubtitle: {
    color: "#aab8de",
    fontSize: 13,
    marginTop: 4
  },
  aiMessages: {
    flex: 1
  },
  aiMessagesContent: {
    paddingBottom: 12,
    gap: 10
  },
  aiMessageWrap: {
    width: "100%"
  },
  aiMessageWrapUser: {
    alignItems: "flex-end"
  },
  aiMessageWrapAssistant: {
    alignItems: "flex-start"
  },
  aiBubble: {
    maxWidth: "88%",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  aiBubbleUser: {
    backgroundColor: "#5ea0ff"
  },
  aiBubbleAssistant: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)"
  },
  aiBubbleText: {
    fontSize: 14,
    lineHeight: 21
  },
  aiBubbleTextUser: {
    color: "#041224",
    fontWeight: "700"
  },
  aiBubbleTextAssistant: {
    color: "#f4f7ff"
  },
  aiTypingBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  aiTypingText: {
    color: "#aab8de",
    fontSize: 13
  },
  aiQuickRow: {
    paddingVertical: 10,
    gap: 8
  },
  aiQuickButton: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  aiQuickButtonText: {
    color: "#aab8de",
    fontSize: 12,
    fontWeight: "700"
  },
  aiInputRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-end",
    marginTop: 8
  },
  aiInput: {
    flex: 1,
    minHeight: 50,
    maxHeight: 120,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(122,162,255,0.16)",
    borderRadius: 16,
    color: "#f4f7ff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: "top"
  },
  aiSendButton: {
    backgroundColor: "#6dffb3",
    borderRadius: 16,
    minWidth: 76,
    height: 50,
    alignItems: "center",
    justifyContent: "center"
  },
  aiSendButtonDisabled: {
    opacity: 0.5
  },
  aiSendButtonText: {
    color: "#062014",
    fontWeight: "800",
    fontSize: 14
  },
  aiFootnote: {
    color: "#8ea2d6",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10
  }
});
