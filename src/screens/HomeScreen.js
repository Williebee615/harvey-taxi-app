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
      const actualError =
        error?.message ||
        "Unknown AI connection error.";

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
            style={styles.aiMessages}
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
    </Modal>
  );
}
