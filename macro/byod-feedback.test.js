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

async function loadMacro(xapi, options = {}) {

xapi.Status.SystemUnit.ProductPlatform.set(options.device);

  xapi.Status.Network[1].IPv4.Address.set(
    options.ipv4Address ?? "192.168.1.100",
  );
  xapi.Status.Network[1].IPv6.Address.set(options.ipv6Address ?? "");

  xapi.Status.UserInterface.ContactInfo.Name.set("Meeting Room 1");

  

  await import(macroName);
  await flushPromises();
}

async function flushPromises() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

supportedDevices.forEach((device) => {
  describe("BYOD Feedback macro - " + device, () => {
    beforeEach(() => {
      jest.resetModules();
      jest.useFakeTimers();
      jest.spyOn(console, "log").mockImplementation(() => {});
      jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.restoreAllMocks();
      jest.useRealTimers();
    });

    it("macro enables WebEngine and Adds Media Access Hostname", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, {device});

      expect(xapi.Config.WebEngine.Mode.set).toHaveBeenCalledWith("On");

      expect(xapi.Command.WebEngine.MediaAccess.Add).toHaveBeenCalledWith({
        Device: "Camera",
        Hostname: "wxsd-sales.github.io",
      });
    });

    it("macro ignore short calls or meetings", async () => {
      const { default: xapi } = await import("xapi");
      xapi.reset();
      await loadMacro(xapi, {device});
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
      await loadMacro(xapi, {device});
      xapi.clearCallHistory();

      xapi.Status.Conference.Call[1].SessionType.set("Call");
      xapi.Status.Conference.Call[1].MeetingPlatform.set("Unknown");
      xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(1);

      expect(xapi.Status.Conference.get).toHaveBeenCalled();

      jest.advanceTimersByTime(2 * 60 * 1000);
      await flushPromises();

      xapi.Status.SystemUnit.State.NumberOfActiveCalls.set(0);

      await flushPromises();

      expect(xapi.Command.UserInterface.WebView.Display).toHaveBeenCalled();
      
    });
  });
});
