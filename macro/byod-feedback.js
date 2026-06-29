/********************************************************
 *
 * Macro Author:      	William Mills
 *                    	Technical Solutions Specialist
 *                    	wimills@cisco.com
 *                    	Cisco Systems
 *
 * Version: 1-0-0
 * Released: 05/20/26
 *
 * Example macro which launches a feedback web app up a meeting ending
 * or a BYOD device disconnection.
 *
 * Full Readme, source code and license agreement available on Github:
 * https://github.com/wxsd-sales/byod-feedback-webapp
 *
 ********************************************************/

import xapi from "xapi";

/*********************************************************
 * Configuration Start
 **********************************************************/

const config = {
  messagePrompt: "Were you satisfied with this Meeting Room Experience?",
  webAppUrl: "https://wxsd-sales.github.io/byod-feedback-webapp/webapp",
  feedback: {
    url: "https://your-backend.example.com/feedback",
    apiKey: "your-api-key",
  },
  timers: {
    autoCloseSeconds: 60,
    emptyRoomAutoCloseSeconds: 10,
    meetingDurationSeconds: 180,
  },
  debug: true,
};

/*********************************************************
 * Configuration End
 **********************************************************/

// Test-only override hook. Undefined in production, so workingConfig === config on-device.
function mergeConfig(base, overrides) {
  if (!overrides || typeof overrides !== "object") return base;
  const result = { ...base };
  for (const key of Object.keys(overrides)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype")
      continue;
    const value = overrides[key];
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? mergeConfig(base[key] ?? {}, value)
        : value;
  }
  return result;
}

const workingConfig = mergeConfig(
  config,
  globalThis.__BYOD_FEEDBACK_TEST_CONFIG__,
);

class EventMonitor {
  /**
   * @param {Function} onInactiveCallback - Called when the active session ends and no new session starts.
   * @param {number} durationThresholdMs - Minimum duration (in milliseconds) the session must have lasted to trigger the callback.
   */
  constructor(onInactiveCallback = null, durationThresholdMs = 0) {
    // Concurrent sessions keyed by type. The survey is only triggered once the
    // room is fully idle (no sessions remain active), so a lower-priority event
    // ending while a higher-priority one continues (e.g. a presentation ending
    // mid-call) will not prompt feedback prematurely.
    this.activeSessions = new Map();
    this.sessionHistory = [];

    // Store the callback and threshold
    this.onInactiveCallback = onInactiveCallback;
    this.durationThresholdMs = durationThresholdMs;

    this.priorities = {
      webexShare: 4,
      call: 3,
      byod: 2,
      presentation: 1,
    };
  }

  startEvent(type, details = {}) {
    if (!this.priorities.hasOwnProperty(type)) {
      warn(`[Warning] Unknown event type: ${type}`);
      return;
    }

    if (this.activeSessions.has(type)) {
      log(`[Ignored] ${type} is already active.`);
      return;
    }

    this.activeSessions.set(type, {
      type: type,
      startTime: Date.now(),
      details: details,
    });

    log(
      `[Started] Session: ${type} | Active sessions: ${this.activeSessions.size}`,
    );
  }

  /**
   * @param {string} type - 'call', 'webexShare', 'byod', or 'presentation'
   * @param {number} [customEndTime] - Optional timestamp
   */
  endEvent(type, customEndTime = Date.now()) {
    const session = this.activeSessions.get(type);
    if (!session) return null;

    this.activeSessions.delete(type);

    const durationMs = customEndTime - session.startTime;

    const completedRecord = {
      type: session.type,
      details: session.details,
      startTime: new Date(session.startTime).toISOString(),
      endTime: new Date(customEndTime).toISOString(),
      durationSeconds: Math.round(durationMs / 1000),
      durationMs: durationMs,
    };

    this.sessionHistory.push(completedRecord);

    const roomIsIdle = this.activeSessions.size === 0;

    log(
      `[Ended] Session: ${type} | Duration: ${completedRecord.durationSeconds}s | Remaining sessions: ${this.activeSessions.size}`,
    );

    // Only prompt for feedback once the room is fully idle (no other concurrent
    // sessions remain, e.g. a presentation ending mid-call, or a BYOD session
    // ending while a presentation continues) and the ended session lasted long
    // enough to be meaningful.
    if (roomIsIdle && durationMs >= this.durationThresholdMs) {
      if (typeof this.onInactiveCallback === "function") {
        this.onInactiveCallback(completedRecord);
      }
    }

    return completedRecord;
  }

  hasActiveSessions() {
    return this.activeSessions.size > 0;
  }

  getActiveSessionTypes() {
    return [...this.activeSessions.keys()];
  }

  getHistory() {
    return this.sessionHistory;
  }

  getLastSession() {
    if (this.sessionHistory.length > 0) {
      return this.sessionHistory[this.sessionHistory.length - 1];
    }
    return null;
  }
}

const monitor = new EventMonitor(
  processEndSession,
  workingConfig.timers.meetingDurationSeconds * 1000,
);
const debounce = (func, delay) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), delay);
  };
};

let emptyRoomTimeout;
let autoCloseTimeout;

function processEndSession(session) {
  log("Session Ended:", session);
  displaySurvey(session);
}

async function processWebViews({ URL }) {
  if (typeof URL == "undefined") return;
  if (!URL.startsWith(workingConfig.webAppUrl)) return;
  debug("Processing WebView URL:", URL);
  if (!URL) return;
  if (!URL.startsWith(workingConfig.webAppUrl)) return;
  const hashes = getHashes(URL);
  debug("Hashes:", hashes);
  if (hashes?.action != "submit") return;
  sendFeedback(hashes?.response);
  debug("Clearing WebView");
  setTimeout(() => {
    xapi.Command.UserInterface.WebView.Clear({ Target: "OSD" });
  }, 3000);
}

async function processPeopleCount(count) {
  if (typeof count == "undefined") {
    count = await xapi.Status.RoomAnalytics.PeopleCount.Current.get();
  }
  debug("People Count :", count);
  if (count > 0) return;
  processEmptyRoomAutoClose();
}

async function processWebcamMode(mode) {
  debug("Webcam Mode:", mode);
  if (mode.startsWith("Streaming")) {
    monitor.startEvent("byod");
  } else {
    monitor.endEvent("byod");
  }
}

async function startAutoClose() {
  debug("Starting Auto Close");
  clearTimeout(autoCloseTimeout);
  autoCloseTimeout = setTimeout(() => {
    debug("Auto Close Timeout");
    closeWebView();
  }, workingConfig.timers.autoCloseSeconds * 1000);
}

async function processEmptyRoomAutoClose() {
  clearTimeout(emptyRoomTimeout);

  emptyRoomTimeout = setTimeout(() => {
    closeWebView();
  }, workingConfig.timers.emptyRoomAutoCloseSeconds * 1000);
}

async function closeWebView() {
  if (!(await webviewOpen())) return;
  debug("Closing WebView");
  return xapi.Command.UserInterface.WebView.Clear({ Target: "OSD" });
}

async function processNumOfCalls(numOfCalls) {
  debug("Number of Active Calls:", numOfCalls);

  if (numOfCalls == 1) {
    const conference = await xapi.Status.Conference.get();

    const call = conference.Call?.[0];
    const sessionType = call?.SessionType;

    if (sessionType == "Share") {
      // Handle Webex Proxity Sharing
      monitor.startEvent("webexShare");
      return;
    }

    const meetingPlatform = call?.MeetingPlatform;

    const webexMeeting = call?.Meeting;

    monitor.startEvent("call", { meetingPlatform, sessionType, webexMeeting });
    return;
  }

  // No active calls — end whichever call-type session was running.
  monitor.endEvent("call");
  monitor.endEvent("webexShare");
}

async function displaySurvey(session) {
  const hash = await generateHash(session);
  const Url = workingConfig.webAppUrl + "#" + hash;
  debug("Displaying Survey - Url:", Url);
  log("Displaying Survey");
  xapi.Command.UserInterface.WebView.Display({
    Mode: "Modal",
    Target: "OSD",
    Title: "Survey",
    Url,
  });

  startAutoClose();
}

async function webviewOpen() {
  const webviews = await xapi.Status.UserInterface.WebView.get();
  debug("Webviews:", webviews);
  return (
    webviews.filter(({ URL }) => URL.startsWith(workingConfig.webAppUrl))
      .length > 0
  );
}

async function processLocalPresentations() {
  debug("Processing Local Presentations");
  const localInstances =
    await xapi.Status.Conference.Presentation.LocalInstance.get();
  debug("Local Instances:", localInstances.length);
  if (localInstances.length == 0) monitor.endEvent("presentation");
  if (localInstances.length > 0) monitor.startEvent("presentation");
}

function extractFQDN(url) {
  const fqdnRegex = /^(?:[a-z]+:\/\/)?(?:[^@\n]+@)?([^:\/\n?#]+)/i;
  const match = url.match(fqdnRegex);
  return match ? match[1] : null;
}

async function generateHash() {
  const result = {
    messagePrompt: workingConfig.messagePrompt,
  };
  return btoa(JSON.stringify(result));
}

async function getDeviceDetails() {
  const deviceDetails = {
    workspaceName: await xapi.Status.UserInterface.ContactInfo.Name.get(),
    ipv4Address: await xapi.Status.Network[1].IPv4.Address.get(),
    ipv6Address: await xapi.Status.Network[1].IPv6.Address.get(),
    deviceId: await xapi.Status.Webex.DeveloperId.get(),
  };
  return deviceDetails;
}

async function sendFeedback(feedback) {
  const device = await getDeviceDetails();
  const lastSession = monitor.getLastSession();
  warn("Last Session:", lastSession);

  const Timeout = 10;
  const Url = workingConfig.feedback.url;
  const body = JSON.stringify({ device, lastSession, feedback });
  const Header = [
    "Content-Type: application/json",
    "Authorization: Bearer " + workingConfig.feedback.apiKey,
  ];
  const ResultBody = "PlainText";

  debug("Sending feedback to:", Url);
  debug("Body:", body);
  debug("Header:", Header);
  debug("ResultBody:", ResultBody);
  debug("Timeout:", Timeout);

  try {
    const response = await xapi.Command.HttpClient.Post(
      { Header, ResultBody, Timeout, Url },
      body,
    );
    debug("Feedback sent successfully");
    alert("Feedback sent successfully", 10);
  } catch (error) {
    warn("Unable to send feedback.", error);
    alert("Unable to send feedback. Please try again later.", 10);
  }
}


function getHashes(url) {
  if (!url) return;
  const hashString = url.split("#")?.slice(1)?.join("#");

  try {
    return JSON.parse(atob(hashString));
  } catch (error) {
    warn("Unable to parse hash parameters.", error);
    return;
  }
}

function alert(Text='', Duration = 10) {
  debug("Displaying Alert", "\nText:", Text, "\nDuration:", Duration);
  xapi.Command.UserInterface.Message.Alert.Display({
    Title: 'BYOD Feedback',
    Text,
    Duration,
  });
}
function log(...args) {
  console.log(...args);
}

function warn(...args) {
  console.warn(...args);
}

function debug(...args) {
  if (!workingConfig.debug) return;
  console.debug(...args);
}

async function init() {
  const Hostname = extractFQDN(workingConfig.webAppUrl);
  if (Hostname == null)
    throw Error("Count not extract hostname from web app url");
  debug("Adding Camera MediaAccess for Hostname:", Hostname);
  // Ensure Camera MediaAccess is added
  xapi.Command.WebEngine.MediaAccess.Add({ Device: "Camera", Hostname });

  // Enable WebEngine and HttpClient
  xapi.Config.WebEngine.Mode.set("On");
  xapi.Config.HttpClient.Mode.set("On");

  // Subscribe to People Count
  xapi.Status.RoomAnalytics.PeopleCount.Current.on(processPeopleCount);
 
  // Subscribe to Local Presentations with a debounce of 1 second
  const debouncedProcessLocalPresentations = debounce(processLocalPresentations, 1000);
  xapi.Status.Conference.Presentation.LocalInstance.on(
    debouncedProcessLocalPresentations,
  );

  // Subscribe to Number of Active Calls
  xapi.Status.SystemUnit.State.NumberOfActiveCalls.on(processNumOfCalls);

  // Subscribe to WebView changes
  xapi.Status.UserInterface.WebView.on(processWebViews);

  // Get the number of active calls
  const numOfCalls =
    await xapi.Status.SystemUnit.State.NumberOfActiveCalls.get();
  
  // Process the number of active calls
  await processNumOfCalls(numOfCalls);

  // Get the webcam mode
  const videoOutput = await xapi.Status.Video.Output.get();
  const webcamMode = videoOutput?.Webcam?.Mode;
  // If the webcam mode is defined, subscribe to webcam mode changes and process the webcam mode
  if(typeof webcamMode != 'undefined') {
    xapi.Status.Video.Output.Webcam.Mode.on(processWebcamMode);
    await processWebcamMode(webcamMode)

  }

  // Finally, process current local presentations
  await processLocalPresentations();
}

// Initialize the macro
// Check if webview is still open before initializing
// Close the Check if the webview is still open
webviewOpen()
.then(async (isOpen) => {
  debug("Webview is still open:", isOpen);
  if (!isOpen) return init();
  await closeWebView();
  setTimeout(init, 1000);
})
.catch(async (error) => {
  warn("Error initializing macro:", error);
  alert("Error initializing macro:", error);
  init();
});