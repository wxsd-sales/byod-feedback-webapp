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
  webAppUrl: "https://wxsd-sales.github.io/byod-feedback-webapp/webapp",
  feedbackUrl: "https://your-backend.example.com/feedback",
  duration: 1,
};

/*********************************************************
 * Configuration End
 **********************************************************/

let meetingStartTime;
let meetingPlatform;
let sessionType;
let webexMeeting;

init();

function init() {
  const Hostname = extractFQDN(config.webAppUrl);
  console.log("Adding Camera MediaAccess for Hostname:", Hostname);
  xapi.Config.WebEngine.Mode.set("On");
  xapi.Command.WebEngine.MediaAccess.Add({ Device: "Camera", Hostname });
  xapi.Status.SystemUnit.State.NumberOfActiveCalls.on(processNumOfCalls);
  xapi.Status.UserInterface.WebView.on(processWebViews);
}


async function processWebViews({URL}){
  console.log('URL:', URL)
  if(!URL) return
  if(!URL.startsWith(config.webAppUrl)) return
  const hashes = getHashes(URL);

  console.log('Hashes:', hashes)

  if(hashes?.action != 'close') return

  console.log('Clearing WebView')
  xapi.Command.UserInterface.WebView.Clear({Target: 'OSD'})



}
async function processNumOfCalls(numOfCalls) {
  console.log("Number of Active Calls:", numOfCalls);

  if (numOfCalls == 1) {
    console.log("New Call Started, storing call start");
    meetingStartTime = Date.now();

    const conference = await xapi.Status.Conference.get();
    console.log("conference:", conference);
    console.log("test:", conference.Call?.[0]);

    meetingPlatform = conference.Call?.[0]?.MeetingPlatform;
    sessionType = conference.Call?.[0]?.SessionType;
    webexMeeting = conference.Call?.[0]?.SessionType;

    return;
  }

  if (meetingStartTime == null) return;

  console.log("Call Ended, calculating duration");

  const duration = getMinutesBetween(meetingStartTime, Date.now());

  console.log("Number Of Minutes:", duration);

  meetingStartTime = null;

  if (duration < config.duration) return;

  const hash = await generateHash({meetingPlatform, sessionType, webexMeeting, duration});

  const Url = config.webAppUrl + "#" + hash;

  console.log("Displaying Survey - Url:", Url);

  xapi.Command.UserInterface.WebView.Display({
    Mode: "Modal",
    Target: "OSD",
    Title: "Survey",
    Url,
  });
}

function getMinutesBetween(start, end) {
  const diffInMs = Math.abs(end - start);
  const diffInMinutes = diffInMs / (1000 * 60);
  return diffInMinutes;
}

function resetMeetingDetails() {
  meetingStartTime = undefined;
  meetingPlatform = undefined;
  sessionType = undefined;
  webexMeeting = undefined;
}

function extractFQDN(url) {
  const fqdnRegex = /^(?:[a-z]+:\/\/)?(?:[^@\n]+@)?([^:\/\n?#]+)/i;
  const match = url.match(fqdnRegex);
  return match ? match[1] : null;
}

async function generateHash(args) {
  const result = { ...args  };

  result.feedbackUrl = config.feedbackUrl;
  result.workspaceName = await xapi.Status.UserInterface.ContactInfo.Name.get();

  return btoa(JSON.stringify(result));
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