import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

const macroName = "./byod-feedback.js";

const supportedDevices = ["Room Bar"];
// const supportedDevices = ["Room Bar", "Room Bar Pro"];

const mockDeviceDetails = {
  workspaceName: "Meeting Room 1",
  ipv4Address: "192.168.1.100",
  ipv6Address: "",
  deviceId: "1234567890",
};

// Baseline config applied to the macro before each test. Individual tests can
// override fields by passing configOverrides to loadMacro().
const testConfig = {
  messagePrompt: "Where you satisfied with this Meeting Room Experience?",
  webAppUrl: "https://wxsd-sales.github.io/byod-feedback-webapp/webapp",
  feedback: {
    url: "https://your-backend.example.com/feedback",
    apiKey: "your-api-key",
  },
  duration: 1,
  debug: true,
};

const mockFeedback = {
  action: "submit",
  feedback: "satisfied",
  label: "Satisfied",
  gesture: "Thumb_Up",
  confidence: 0.7694,
  heldForMs: 5000,
  collectedAt: "2026-06-24T13:55:40.363Z",
};

const mockCallSession = {
  type: "call",
  details: {
    meetingPlatform: "Unknown",
    sessionType: "Call",
    webexMeeting: "False",
  },
  startTime: "2026-06-24T13:55:40.363Z",
  endTime: "2026-06-24T13:55:45.363Z",
  durationSeconds: 5,
  durationMs: 5000,
};

const mockByodSession = {
  type: "byod",
  startTime: "2026-06-24T13:55:40.363Z",
  endTime: "2026-06-24T13:55:45.363Z",
  durationSeconds: 5,
  durationMs: 5000,
};

const mockPresentationSession = {
  type: "presentation",
  startTime: "2026-06-24T13:55:40.363Z",
  endTime: "2026-06-24T13:55:45.363Z",
  durationSeconds: 5,
  durationMs: 5000,
};

async function loadMacro(xapi, productPlatform, configOverrides = {}) {
  globalThis.__BYOD_FEEDBACK_TEST_CONFIG__ = {
    ...(globalThis.__BYOD_FEEDBACK_TEST_CONFIG__ ?? {}),
    ...configOverrides,
  };

  xapi.Status.SystemUnit.ProductPlatform.set(productPlatform);
  xapi.Status.Network[1].IPv4.Address.set(mockDeviceDetails.ipv4Address);
  xapi.Status.Network[1].IPv6.Address.set(mockDeviceDetails.ipv6Address);
  xapi.Status.Webex.DeveloperId.set(mockDeviceDetails.deviceId);
  xapi.Status.UserInterface.ContactInfo.Name.set(
    mockDeviceDetails.workspaceName,
  );

  xapi.Status.Conference.Presentation.LocalInstance.get.mockReturnValue([]);

  xapi.Status.Video.Output.Webcam.Mode.set("Disconnected");
  xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(0);

  await import(macroName);
  await flushPromises();
}

async function flushPromises() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function startCallSession(xapi) {
  xapi.Status.Conference.Call[1].SessionType.set("Call");
  xapi.Status.Conference.Call[1].MeetingPlatform.set("Unknown");
  xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(1);
}

async function endCallSession(xapi) {
  xapi.Status.Conference.Call[1].remove();
  xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(0);
}

async function startByodSession(xapi) {
  xapi.Status.Video.Output.Webcam.Mode.set("Streaming");
}

async function endByodSession(xapi) {
  xapi.Status.Video.Output.Webcam.Mode.set("Disconnected");
}

async function startLocalPresentationSession(xapi) {
  xapi.Status.Conference.Presentation.LocalInstance.get.mockReturnValue([{
    SendingMode: "LocalOnly",
    Source: 1,
  }]);
  xapi.Status.Conference.Presentation.LocalInstance[1].SendingMode.set('LocalOnly');
  xapi.Status.Conference.Presentation.LocalInstance[1].Source.set(1);
  
}

async function endLocalPresentationSession(xapi) {
  xapi.Status.Conference.Presentation.LocalInstance.get.mockReturnValue([]);
  xapi.Status.Conference.Presentation.LocalInstance[1].remove();
}

async function startWebexPresentationSession(xapi) {
  xapi.Status.Conference.Call[1].SessionType.set("Share");
  xapi.Status.Conference.Call[1].MeetingPlatform.set("Webex");
}

async function endWebexPresentationSession(xapi) {
  xapi.Status.Conference.Call[1].remove();
}

async function updateWebViewUrl(xapi, baseUrl, response = mockFeedback) {
  const hash = btoa(JSON.stringify(response));
  const url = baseUrl + "#" + hash;
  xapi.Status.UserInterface.WebView[1].URL.set(url);
}

async function getResponseFromWebView(xapi) {
  const webviewDisplayCall =
        xapi.Command.UserInterface.WebView.Display.mock.calls.pop();
  
        const webviewUrl = webviewDisplayCall?.[0]?.Url;

        if(!webviewUrl) return;



      const webviewUrlbase = webviewUrl.split("#")[0];

      if(!webviewUrl) return;

      updateWebViewUrl(xapi, webviewUrlbase);

      await flushPromises();

      expect(xapi.Command.HttpClient.Post).toHaveBeenCalled();

      const httpPostCall = xapi.Command.HttpClient.Post.mock.calls.pop();

      const body = httpPostCall?.[1];

      expect(body).toBeDefined();

      const payload = JSON.parse(body);

      expect(payload).toBeDefined();

      return payload;
}

function getDisplayedSurveyUrl(xapi) {
  const displayCalls = xapi.Command.UserInterface.WebView.Display.mock.calls;
  return displayCalls.at(-1)?.[0]?.Url;
}

// Simulates the survey webview being open on the OSD by writing the displayed
// survey URL into the WebView status so webviewOpen() reports it as open.
async function openDisplayedSurvey(xapi) {
  const url = getDisplayedSurveyUrl(xapi);
  if (!url) throw new Error("No survey webview was displayed");
  xapi.Status.UserInterface.WebView[1].URL.set(url);
  await flushPromises();
}

// Runs a qualifying call long enough to trigger the survey on hang up.
async function displaySurveyViaCall(xapi) {
  startCallSession(xapi);
  await flushPromises();
  jest.advanceTimersByTime(3 * 60 * 1000);
  endCallSession(xapi);
  await flushPromises();
}

supportedDevices.forEach((productPlatform) => {
  describe("BYOD Feedback macro - " + productPlatform, () => {
    beforeEach(() => {
      jest.resetModules();
      jest.useFakeTimers();
      globalThis.__BYOD_FEEDBACK_TEST_CONFIG__ = structuredClone(testConfig);
      // jest.spyOn(console, "log").mockImplementation(() => {});
      // jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.restoreAllMocks();
      jest.useRealTimers();
      delete globalThis.__BYOD_FEEDBACK_TEST_CONFIG__;
    });

    it("macro enables WebEngine and Adds Media Access Hostname", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform);

      expect(xapi.Config.WebEngine.Mode.set).toHaveBeenCalledWith("On");

      expect(xapi.Command.WebEngine.MediaAccess.Add).toHaveBeenCalledWith({
        Device: "Camera",
        Hostname: "wxsd-sales.github.io",
      });
    });

    it("macro ignore short calls or meetings", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform );
      xapi.clearCallHistory();

      startCallSession(xapi);

      expect(xapi.Status.Conference.get).toHaveBeenCalled();

      jest.advanceTimersByTime(1);

      endCallSession(xapi);

      await flushPromises();

      expect(xapi.Command.UserInterface.WebView.Display).not.toHaveBeenCalled();

      const response = await getResponseFromWebView(xapi);
      expect(response).toBeUndefined();
    });

    it("macro processes long calls or meetings", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform );
      xapi.clearCallHistory();

      startCallSession(xapi);

      expect(xapi.Status.Conference.get).toHaveBeenCalled();

      await flushPromises();

      jest.advanceTimersByTime(3 * 60 * 1000);

      endCallSession(xapi);

      await flushPromises();

      expect(xapi.Command.UserInterface.WebView.Display).toHaveBeenCalled();

      const response = await getResponseFromWebView(xapi);
      expect(response?.lastSession?.type).toEqual("call");
    });

    it("macro processes byod session", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform);
      xapi.clearCallHistory();

      startByodSession(xapi);

      jest.advanceTimersByTime(2 * 60 * 1000);
      await flushPromises();

      endByodSession(xapi);

      await flushPromises();

      expect(xapi.Command.UserInterface.WebView.Display).toHaveBeenCalled();

      const response = await getResponseFromWebView(xapi);
      expect(response?.lastSession?.type).toEqual("byod");
    });

    it("macro processes local presentation session", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform);
      xapi.clearCallHistory();

      startLocalPresentationSession(xapi);
      
      
      await flushPromises();
      jest.advanceTimersByTime(2 * 60 * 1000);

      endLocalPresentationSession(xapi);

      await flushPromises();

      expect(xapi.Command.UserInterface.WebView.Display).toHaveBeenCalled();


      const response = await getResponseFromWebView(xapi);
      expect(response?.lastSession?.type).toEqual("presentation");

    });

    it("does not show the survey when a presentation ends while still on a call", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform);
      xapi.clearCallHistory();

      // Call is running.
      startCallSession(xapi);
      await flushPromises();
      jest.advanceTimersByTime(3 * 60 * 1000);

      // A local presentation starts and then ends, all while still on the call.
      startLocalPresentationSession(xapi);
      await flushPromises();
      jest.advanceTimersByTime(30 * 1000);
      endLocalPresentationSession(xapi);
      await flushPromises();

      // Survey must not show because the call is still active.
      expect(xapi.Command.UserInterface.WebView.Display).not.toHaveBeenCalled();

      // Once the call ends and the room is idle, the survey is shown for the call.
      endCallSession(xapi);
      await flushPromises();

      expect(xapi.Command.UserInterface.WebView.Display).toHaveBeenCalled();

      const response = await getResponseFromWebView(xapi);
      expect(response?.lastSession?.type).toEqual("call");
    });

    it("does not show the survey when a byod session ends while a presentation continues", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform);
      xapi.clearCallHistory();

      // A local presentation is running.
      startLocalPresentationSession(xapi);
      await flushPromises();
      jest.advanceTimersByTime(2 * 60 * 1000);

      // A BYOD (laptop) session starts and then ends while presenting continues.
      startByodSession(xapi);
      await flushPromises();
      jest.advanceTimersByTime(30 * 1000);
      endByodSession(xapi);
      await flushPromises();

      // Survey must not show because the presentation is still active.
      expect(xapi.Command.UserInterface.WebView.Display).not.toHaveBeenCalled();

      // Once the presentation ends and the room is idle, the survey is shown.
      endLocalPresentationSession(xapi);
      await flushPromises();

      expect(xapi.Command.UserInterface.WebView.Display).toHaveBeenCalled();

      const response = await getResponseFromWebView(xapi);
      expect(response?.lastSession?.type).toEqual("presentation");
    });

    it("auto closes the survey webview after the inactivity timeout", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform);
      xapi.clearCallHistory();

      await displaySurveyViaCall(xapi);

      expect(xapi.Command.UserInterface.WebView.Display).toHaveBeenCalled();

      // The survey webview is now open on the OSD.
      await openDisplayedSurvey(xapi);

      // Still open just before the 60s inactivity timeout.
      jest.advanceTimersByTime(59 * 1000);
      await flushPromises();
      expect(
        xapi.Command.UserInterface.WebView.Clear,
      ).not.toHaveBeenCalled();

      // Auto-closes once the timeout elapses.
      jest.advanceTimersByTime(1 * 1000);
      await flushPromises();
      expect(xapi.Command.UserInterface.WebView.Clear).toHaveBeenCalledWith({
        Target: "OSD",
      });
    });

    [0, -1].forEach((emptyCount) => {
      it(`auto closes the survey faster when the room empties (people count ${emptyCount})`, async () => {
        const { default: xapi } = await import("xapi");
        xapi.reset();
        await loadMacro(xapi, productPlatform);
        xapi.clearCallHistory();

        await displaySurveyViaCall(xapi);

        expect(xapi.Command.UserInterface.WebView.Display).toHaveBeenCalled();

        // The survey webview is now open on the OSD.
        await openDisplayedSurvey(xapi);

        // Room becomes empty - triggers the faster empty-room auto close.
        xapi.Status.RoomAnalytics.PeopleCount.Current.set(emptyCount);
        await flushPromises();

        // Not yet closed just before the 10s empty-room timeout.
        jest.advanceTimersByTime(9 * 1000);
        await flushPromises();
        expect(
          xapi.Command.UserInterface.WebView.Clear,
        ).not.toHaveBeenCalled();

        // Closes after 10s, well before the 60s inactivity timeout.
        jest.advanceTimersByTime(1 * 1000);
        await flushPromises();
        expect(xapi.Command.UserInterface.WebView.Clear).toHaveBeenCalledWith({
          Target: "OSD",
        });
      });
    });
  });
});
