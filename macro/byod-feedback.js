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
  messagePrompt: "Where you satisfied with this Meeting Room Experience?",
  webAppUrl: "https://wxsd-sales.github.io/byod-feedback-webapp/webapp",
  feedback: {
    url: "https://your-backend.example.com/feedback",
    apiKey: "your-api-key",
  },
  duration: 1,
  debug: true,
};

/*********************************************************
 * Configuration End
 **********************************************************/

class EventMonitor {
  /**
   * @param {Function} onInactiveCallback - Called when the active session ends and no new session starts.
   * @param {number} durationThresholdMs - Minimum duration (in milliseconds) the session must have lasted to trigger the callback.
   */
  constructor(onInactiveCallback = null, durationThresholdMs = 0) {
    this.activeSession = null;
    this.sessionHistory = [];

    // Store the callback and threshold
    this.onInactiveCallback = onInactiveCallback;
    this.durationThresholdMs = durationThresholdMs;

    this.priorities = {
      call: 3,
      byod: 2,
      presentation: 1,
    };
  }

  startEvent(type, details = {}) {
    if (!this.priorities.hasOwnProperty(type)) {
      console.warn(`[Warning] Unknown event type: ${type}`);
      return;
    }

    const now = Date.now();

    if (this.activeSession) {
      const currentPriority = this.priorities[this.activeSession.type];
      const newPriority = this.priorities[type];

      if (newPriority <= currentPriority) {
        console.log(
          `[Ignored] ${type} started, but ${this.activeSession.type} is active.`,
        );
        return;
      }

      console.log(
        `[Interrupted] ${this.activeSession.type} interrupted by ${type}.`,
      );
      // Pass 'true' for _isInterruption so the inactive callback doesn't fire
      this.endEvent(this.activeSession.type, now, true);
    }

    this.activeSession = {
      type: type,
      startTime: now,
      details: details,
    };

    console.log(`[Started] Session: ${type}`);
  }

  /**
   * @param {string} type - 'call', 'byod', or 'presentation'
   * @param {number} [customEndTime] - Optional timestamp
   * @param {boolean} [_isInterruption=false] - Internal flag to prevent callback during priority swaps
   */
  endEvent(type, customEndTime = Date.now(), _isInterruption = false) {
    if (!this.activeSession || this.activeSession.type !== type) {
      return null;
    }

    const session = this.activeSession;
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
    this.activeSession = null; // Clear the active state

    console.log(
      `[Ended] Session: ${type} | Duration: ${completedRecord.durationSeconds}s`,
    );

    // Check conditions for the callback:
    // 1. Not an interruption (meaning no other event is taking over)
    // 2. The session duration meets or exceeds the threshold
    if (!_isInterruption && durationMs >= this.durationThresholdMs) {
      if (typeof this.onInactiveCallback === "function") {
        this.onInactiveCallback(completedRecord);
      }
    }

    return completedRecord;
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

const monitor = new EventMonitor(processEndSession, config.duration);

function processEndSession(session) {
  console.log("Session Ended:", session);

  displaySurvey(session);
}

async function processWebViews({ URL }) {
  console.log("URL:", URL);
  if (!URL) return;
  if (!URL.startsWith(config.webAppUrl)) return;
  const hashes = getHashes(URL);
  console.log("Hashes:", hashes);
  if (hashes?.action != "submit") return;
  sendFeedback(hashes);
  console.log("Clearing WebView");
  setTimeout(() => {
    xapi.Command.UserInterface.WebView.Clear({ Target: "OSD" });
  }, 3000);
}

async function processWebcamMode(mode) {
  console.log("Webcam Mode:", mode);
  if (mode.startsWith('Streaming')) {
    monitor.startEvent("byod");
  } else {
    monitor.endEvent("byod");
  }
}

async function processNumOfCalls(numOfCalls) {
  console.log("Number of Active Calls:", numOfCalls);

  if (numOfCalls == 1) {
    const conference = await xapi.Status.Conference.get();
    const meetingPlatform = conference.Call?.[0]?.MeetingPlatform;
    const sessionType = conference.Call?.[0]?.SessionType;
    const webexMeeting = conference.Call?.[0]?.SessionType;
    monitor.startEvent("call", { meetingPlatform, sessionType, webexMeeting });
    return;
  }

  monitor.endEvent("call");
}

async function displaySurvey(session) {
  const hash = await generateHash(session);
  const Url = config.webAppUrl + "#" + hash;
  console.log("Displaying Survey - Url:", Url);
  xapi.Command.UserInterface.WebView.Display({
    Mode: "Modal",
    Target: "OSD",
    Title: "Survey",
    Url,
  });
}

async function processPresentationMode(mode) {
  console.log("Processing Presentation Mode:", mode);
}

async function processAirPlayActivity(activity) {
  console.log("Processing Air Play Activity:", activity);
  if (activity) {
    monitor.startEvent("presentation");
  } else {
    monitor.endEvent("presentation");
  }
}

function extractFQDN(url) {
  const fqdnRegex = /^(?:[a-z]+:\/\/)?(?:[^@\n]+@)?([^:\/\n?#]+)/i;
  const match = url.match(fqdnRegex);
  return match ? match[1] : null;
}

async function generateHash(session) {
  const result = { session };
  result.feedbackUrl = config.feedbackUrl;
  result.workspaceName = await xapi.Status.UserInterface.ContactInfo.Name.get();
  return btoa(JSON.stringify(result));
}

async function getDeviceDetails() {
  const deviceDetails = {
    workspaceName: await xapi.Status.UserInterface.ContactInfo.Name.get(),
    ipv4Address: await xapi.Status.Network[1].IPv4.Address.get(),
    ipv6Address: await xapi.Status.Network[1].IPv6.Address.get(),
    deviceId: await xapi.Status.Webex.DeveloperId.get()
  };
  return deviceDetails;
}

async function sendFeedback(feedback) {

  const deviceDetails = await getDeviceDetails();
  const lastSession = monitor.getLastSession();
  console.warn("Last Session:", lastSession);

  const Timeout = 10;
  const Url = config.feedback.url;
  const body = JSON.stringify({ deviceDetails, lastSession, feedback });
  const Header = [
    "Content-Type: application/json",
    "Authorization: Bearer " + config.feedback.apiKey,
  ];
  const ResultBody = "PlainText";

  try {
    const response = await xapi.Command.HttpClient.Post(
      { Header, ResultBody, Timeout, Url },
      body,
    );
  } catch (error) {
    console.warn("Unable to send feedback.", error);
  }
}

function getHashes(url) {
  if (!url) return;
  const hashString = url.split("#")?.slice(1)?.join("#");

  try {
    return JSON.parse(atob(hashString));
  } catch (error) {
    console.warn("Unable to parse hash parameters.", error);
    return;
  }
}

function log(message) {
  if (config.debug) {
    console.log(message);
  }
}

async function init() {
  const Hostname = extractFQDN(config.webAppUrl);
  console.log("Adding Camera MediaAccess for Hostname:", Hostname);
  xapi.Config.WebEngine.Mode.set("On");
  xapi.Config.HttpClient.Mode.set("On");
  xapi.Command.WebEngine.MediaAccess.Add({ Device: "Camera", Hostname });

  xapi.Status.SystemUnit.State.NumberOfActiveCalls.on(processNumOfCalls);
  xapi.Status.Video.Output.Webcam.Mode.on(processWebcamMode);
  xapi.Status.Conference.Presentation.Mode.on(processPresentationMode);
  xapi.Status.Video.Input.AirPlay.Activity.on(processAirPlayActivity);

  xapi.Status.UserInterface.WebView.on(processWebViews);

  const numOfCalls =
    await xapi.Status.SystemUnit.State.NumberOfActiveCalls.get();
  processNumOfCalls(numOfCalls);

  const webcamStatus = await xapi.Status.Video.Output.Webcam.Mode.get();
  processWebcamMode(webcamStatus);

  const presentationMode = await xapi.Status.Conference.Presentation.Mode.get();
  processPresentationMode(presentationMode);

  const airPlayActivity = await xapi.Status.Video.Input.AirPlay.Activity.get();
  processAirPlayActivity(airPlayActivity);

  
}

init();
