import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

const macroName = "./byod-feedback.js";

const supportedDevices = ["Room Bar", "Room Bar Pro"];

const mockDeviceDetails = {
  workspaceName: "Meeting Room 1",
  ipv4Address: "192.168.1.100",
  ipv6Address: "",
  deviceId: "1234567890",
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

async function loadMacro(xapi, productPlatform) {

  xapi.Status.SystemUnit.ProductPlatform.set(productPlatform);
  xapi.Status.Network[1].IPv4.Address.set(mockDeviceDetails.ipv4Address);
  xapi.Status.Network[1].IPv6.Address.set(mockDeviceDetails.ipv6Address);
  xapi.Status.Webex.DeveloperId.set(mockDeviceDetails.deviceId);
  xapi.Status.UserInterface.ContactInfo.Name.set(mockDeviceDetails.workspaceName);

  xapi.Status.Video.Output.Webcam.Mode.set("Disconnected");
  xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(0);

  await import(macroName);
  await flushPromises();
}

async function flushPromises() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

supportedDevices.forEach((productPlatform) => {
  describe("BYOD Feedback macro - " + productPlatform, () => {
    beforeEach(() => {
      jest.resetModules();
      jest.useFakeTimers();
      // jest.spyOn(console, "log").mockImplementation(() => {});
      // jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.restoreAllMocks();
      jest.useRealTimers();
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

      xapi.Status.Conference.Call[1].SessionType.set("Call");
      xapi.Status.Conference.Call[1].MeetingPlatform.set("Unknown");
      xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(1);

      expect(xapi.Status.Conference.get).toHaveBeenCalled();

      jest.advanceTimersByTime(1);

      xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(0);
      expect(xapi.Command.UserInterface.WebView.Display).not.toHaveBeenCalled();
    });

    it("macro processes long calls or meetings", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform );
      xapi.clearCallHistory();

      xapi.Status.Conference.Call[1].SessionType.set("Call");
      xapi.Status.Conference.Call[1].MeetingPlatform.set("Unknown");
      xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(1);

      expect(xapi.Status.Conference.get).toHaveBeenCalled();

      await flushPromises();

      jest.advanceTimersByTime(3 * 60 * 1000);

      xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(0);

      await flushPromises();

      expect(xapi.Command.UserInterface.WebView.Display).toHaveBeenCalled();
    });

    it("macro processes connected laptop", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform);
      xapi.clearCallHistory();

      xapi.Status.Video.Output.Webcam.Mode.set("Streaming");

      jest.advanceTimersByTime(2 * 60 * 1000);
      await flushPromises();

      xapi.Status.Video.Output.Webcam.Mode.set("Disconnected");

      await flushPromises();

      expect(xapi.Command.UserInterface.WebView.Display).toHaveBeenCalled();
    });

    it("macro processes connected laptop", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform );
      xapi.clearCallHistory();

      xapi.Status.Video.Output.Webcam.Mode.set("Streaming");

      jest.advanceTimersByTime(2 * 60 * 1000);
      await flushPromises();

      xapi.Status.Video.Output.Webcam.Mode.set("Disconnected");

      await flushPromises();

      expect(xapi.Command.UserInterface.WebView.Display).toHaveBeenCalled();
    });

    it("Sends Call Feedback", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform );
      xapi.clearCallHistory();

      xapi.Status.Conference.Call[1].SessionType.set("Call");
      xapi.Status.Conference.Call[1].MeetingPlatform.set("Unknown");
      xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(1);

      jest.advanceTimersByTime(2 * 60 * 1000);
      await flushPromises();

      xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(1);

      await flushPromises();


      const hash = btoa(JSON.stringify(mockFeedback));

      
      const url = "https://wxsd-sales.github.io/byod-feedback-webapp/webapp#" + hash;

      xapi.Status.UserInterface.WebView[1].URL.set(url);

      await flushPromises();

      const body = JSON.stringify({ 
        deviceDetails: mockDeviceDetails,
        lastSession: mockLastSession,
        feedback: mockFeedback 
      });


      expect(xapi.Command.HttpClient.Post).toHaveBeenCalled();
      jest.advanceTimersByTime(5 * 1000);
      await flushPromises();

      expect(xapi.Command.UserInterface.WebView.Clear).toHaveBeenCalled();
    });


    it("Sends Call Disconnect Details Once a call and presentation has ended", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, productPlatform );
      xapi.clearCallHistory();

      xapi.Status.Conference.Call[1].SessionType.set("Call");
      xapi.Status.Conference.Call[1].MeetingPlatform.set("Unknown");
      xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(1);

      jest.advanceTimersByTime(2 * 60 * 1000);
      await flushPromises();

      xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(1);

      await flushPromises();
      
      const hash = btoa(JSON.stringify(mockFeedback));

      const url = "https://wxsd-sales.github.io/byod-feedback-webapp/webapp#" + hash;

      xapi.Status.UserInterface.WebView[1].URL.set(url);

      await flushPromises();

      expect(xapi.Command.HttpClient.Post).toHaveBeenCalled();
      jest.advanceTimersByTime(5 * 1000);
      await flushPromises();

      expect(xapi.Command.UserInterface.WebView.Clear).toHaveBeenCalled();
    });
  });
});
