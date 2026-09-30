/*
 * Pure helpers shared by the wizard UI and the unit tests. Keeping these free
 * of DOM access means they can be imported directly in Node for testing and
 * in the browser as an ES module.
 *
 * These helpers read and write the `const config = {...}` block in
 * macro/byod-feedback.js, delimited by the CONFIG:start / CONFIG:end markers.
 */

export const CONFIG_START = "// CONFIG:start";
export const CONFIG_END = "// CONFIG:end";

export const MIN_HOLD_SECONDS = 1;
export const MAX_HOLD_SECONDS = 30;

export const WEBEX_API_BASE = "https://webexapis.com/v1";

// Sample data used to preview what the macro sends, both to a custom backend
// (see buildCustomPayloadPreview) and to Webex (see buildFeedbackMarkdown).
// Mirrors the example in the README.
export const SAMPLE_DEVICE = {
  workspaceName: "Meeting Room 1",
  ipv4Address: "192.168.1.100",
  ipv6Address: "",
  deviceId: "1234567890",
};

export const SAMPLE_SESSION = {
  type: "call",
  details: {
    meetingPlatform: "Unknown",
    sessionType: "Call",
    webexMeeting: "False",
  },
  startTime: "2026-06-29T14:30:01.798Z",
  endTime: "2026-06-29T14:33:01.798Z",
  durationSeconds: 180,
  durationMs: 180000,
};

export const SAMPLE_FEEDBACK = {
  feedback: "satisfied",
  label: "Satisfied",
  gesture: "Thumb_Up",
  confidence: 0.7694,
  heldForMs: 5000,
  collectedAt: "2026-06-24T13:55:40.363Z",
};

/**
 * Normalises a value to a non-negative integer, or `fallback` for anything
 * else (missing, negative, or non-integer).
 */
export function normalizeSeconds(value, fallback = 0) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : fallback;
}

/**
 * Clamps a value to a whole number of seconds between MIN_HOLD_SECONDS and
 * MAX_HOLD_SECONDS, matching how the web app interprets the
 * "gestureHoldSeconds" URL hash parameter. Non-numeric values fall back to
 * `fallback`.
 */
export function clampHoldSeconds(value, fallback = 5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.round(num);
  return Math.min(Math.max(rounded, MIN_HOLD_SECONDS), MAX_HOLD_SECONDS);
}

function extractConfigBlock(source) {
  const startIdx = source.indexOf(CONFIG_START);
  const endIdx = source.indexOf(CONFIG_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      "Could not find the CONFIG:start / CONFIG:end markers in the macro source.",
    );
  }
  return {
    before: source.slice(0, startIdx),
    block: source.slice(startIdx + CONFIG_START.length, endIdx),
    after: source.slice(endIdx + CONFIG_END.length),
  };
}

/**
 * Parses the macro's own `const config = {...}` block into a plain object,
 * so the wizard can use the macro's real, shipped values as its form
 * defaults instead of duplicating them by hand.
 */
export function parseConfig(source) {
  const { block } = extractConfigBlock(source);
  try {
    // The block is our own macro source (same repo, same deploy), not
    // user-supplied input, so evaluating it to recover the object literal
    // is safe here.
    // eslint-disable-next-line no-new-func
    return new Function(`"use strict";\n${block}\nreturn config;`)();
  } catch (error) {
    throw new Error("Could not parse the CONFIG block in the macro source.");
  }
}

/**
 * Build the CONFIG block (markers included) for the given values.
 */
export function buildSnippet({
  messagePrompt = "",
  webAppUrl = "",
  feedbackDestination = "custom",
  feedbackUrl = "",
  feedbackApiKey = "",
  webexBotAccessToken = "",
  webexTarget = "room",
  webexRoomId = "",
  webexToPersonEmail = "",
  autoCloseSeconds = 60,
  emptyRoomAutoCloseSeconds = 10,
  meetingDurationSeconds = 180,
  gestureHoldSeconds = 5,
  debug = false,
} = {}) {
  return [
    CONFIG_START,
    "const config = {",
    `  messagePrompt: ${JSON.stringify(messagePrompt)},`,
    `  webAppUrl: ${JSON.stringify(webAppUrl)},`,
    "  feedback: {",
    `    destination: ${JSON.stringify(feedbackDestination === "webex" ? "webex" : "custom")},`,
    `    url: ${JSON.stringify(feedbackUrl)},`,
    `    apiKey: ${JSON.stringify(feedbackApiKey)},`,
    "    webex: {",
    `      botAccessToken: ${JSON.stringify(webexBotAccessToken)},`,
    `      target: ${JSON.stringify(webexTarget === "person" ? "person" : "room")},`,
    `      roomId: ${JSON.stringify(webexRoomId)},`,
    `      toPersonEmail: ${JSON.stringify(webexToPersonEmail)},`,
    "    },",
    "  },",
    "  timers: {",
    `    autoCloseSeconds: ${normalizeSeconds(autoCloseSeconds, 60)},`,
    `    emptyRoomAutoCloseSeconds: ${normalizeSeconds(emptyRoomAutoCloseSeconds, 10)},`,
    `    meetingDurationSeconds: ${normalizeSeconds(meetingDurationSeconds, 180)},`,
    `    gestureHoldSeconds: ${clampHoldSeconds(gestureHoldSeconds)},`,
    "  },",
    `  debug: ${Boolean(debug)},`,
    "};",
    CONFIG_END,
  ].join("\n");
}

/**
 * Replace the CONFIG block inside an existing macro source with fresh
 * values, preserving everything around the markers. Idempotent.
 */
export function injectConfig(source, values) {
  const { before, after } = extractConfigBlock(source);
  return `${before}${buildSnippet(values)}${after}`;
}

/**
 * Formats a duration in seconds as e.g. "3m" or "1m 30s" or "45s", matching
 * the macro's own formatDuration().
 */
export function formatDuration(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins <= 0) return `${secs}s`;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/**
 * Builds the same Webex-markdown message the macro sends
 * (buildFeedbackMarkdown in macro/byod-feedback.js) - kept in sync by hand
 * since the macro must stay a single, standalone file. Used to render the
 * "what will this look like in Webex" preview.
 */
export function buildFeedbackMarkdown({
  device = SAMPLE_DEVICE,
  lastSession = SAMPLE_SESSION,
  feedback = SAMPLE_FEEDBACK,
} = {}) {
  const isSatisfied = feedback?.feedback === "satisfied";
  const emoji = isSatisfied ? "\u{1F44D}" : "\u{1F44E}";
  const label = feedback?.label || (isSatisfied ? "Satisfied" : "Not satisfied");
  const confidence =
    typeof feedback?.confidence === "number"
      ? `${Math.round(feedback.confidence * 100)}%`
      : "—";
  const sessionType = lastSession?.type
    ? lastSession.type.charAt(0).toUpperCase() + lastSession.type.slice(1)
    : "Unknown";
  const duration = formatDuration(lastSession?.durationSeconds);
  const collectedAt = feedback?.collectedAt
    ? new Date(feedback.collectedAt).toLocaleString()
    : new Date().toLocaleString();

  return [
    `**${emoji} Meeting Room Feedback — ${label}**`,
    "",
    `- **Room:** ${device?.workspaceName || "Unknown"}`,
    `- **Session:** ${sessionType}${duration ? ` — ${duration}` : ""}`,
    `- **Confidence:** ${confidence}`,
    `- **Collected:** ${collectedAt}`,
    "",
    "---",
    `Device ID: ${device?.deviceId || "—"}`,
  ].join("\n");
}

/**
 * Builds a representative "POST <url> ... <body>" preview of what the macro
 * sends to a custom backend, for display in the wizard.
 */
export function buildCustomPayloadPreview({
  url = "",
  apiKey = "",
  device = SAMPLE_DEVICE,
  lastSession = SAMPLE_SESSION,
  feedback = SAMPLE_FEEDBACK,
} = {}) {
  const body = JSON.stringify({ device, lastSession, feedback }, null, 2);
  return [
    `POST ${url || "(feedback backend URL)"}`,
    "Content-Type: application/json",
    `Authorization: Bearer ${apiKey || "(none)"}`,
    "",
    body,
  ].join("\n");
}
