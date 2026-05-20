const hashes = getHashes();
// Set this to your feedback endpoint to enable HTTP POST submission.
const WEB_APP_FEEDBACK_URL = "";
const FEEDBACK_POST_URL = hashes?.feedbackUrl || WEB_APP_FEEDBACK_URL;
const HOLD_DURATION_MS = 5000;
const HOLD_LOST_GRACE_MS = 450;
const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task";

const FEEDBACK_BY_GESTURE = {
  Thumb_Up: {
    key: "up",
    value: "satisfied",
    label: "Satisfied",
    mark: "👍",
  },
  Thumb_Down: {
    key: "down",
    value: "not_satisfied",
    label: "Not satisfied",
    mark: "👎",
  },
};

const promptPanel = document.querySelector(".prompt-panel");
const cameraStage = document.querySelector("#cameraStage");
const feedbackChoices = document.querySelector("#feedbackChoices");
const video = document.querySelector("#webcam");
const mockPerson = document.querySelector("#mockPerson");
const gestureConfirmation = document.querySelector("#gestureConfirmation");
const holdRing = document.querySelector("#holdRing");
const thumbMark = document.querySelector("#thumbMark");
const holdLabel = document.querySelector("#holdLabel");
const thanksPanel = document.querySelector("#thanksPanel");
const thanksThumb = document.querySelector("#thanksThumb");


let GestureRecognizer;
let recognizer;
let stream;
let animationFrameId = 0;
let lastVideoTime = -1;
let holdGesture;
let holdStartedAt = 0;
let holdLastSeenAt = 0;
let holdScore = 0;
let submitted = false;

void initialize();

async function initialize() {
  if (renderHashView(hashes?.view)) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn("Camera unavailable.");
    return;
  }

  try {
    const visionTasks = await import("@mediapipe/tasks-vision");
    GestureRecognizer = visionTasks.GestureRecognizer;
    const { FilesetResolver } = visionTasks;
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
    recognizer = await createRecognizer(vision);

    await openCamera();
  } catch (error) {
    console.error(error);
  }
}

function renderHashView(view) {
  if (!["startup", "countdown", "success"].includes(view)) {
    return false;
  }

  document.body.dataset.view = view;
  stopCamera();
  resetHold();

  if (view === "success") {
    showSuccessMock();
    return true;
  }

  promptPanel.hidden = false;
  cameraStage.hidden = false;
  feedbackChoices.hidden = false;
  thanksPanel.hidden = true;
  video.hidden = true;
  mockPerson.hidden = false;

  if (view === "countdown") {
    showCountdownMock();
  }

  return true;
}

function showCountdownMock() {
  const feedback = FEEDBACK_BY_GESTURE.Thumb_Up;

  gestureConfirmation.dataset.gesture = feedback.key;
  thumbMark.textContent = feedback.mark;
  holdRing.style.setProperty("--progress", "216deg");
  holdLabel.textContent = "Hold for 2 seconds";
  gestureConfirmation.classList.add("is-visible");
}

function showSuccessMock() {
  const feedback = FEEDBACK_BY_GESTURE.Thumb_Up;

  promptPanel.hidden = true;
  cameraStage.hidden = true;
  feedbackChoices.hidden = true;
  video.hidden = true;
  mockPerson.hidden = true;
  thanksPanel.dataset.gesture = feedback.key;
  thanksThumb.textContent = feedback.mark;
  thanksPanel.hidden = false;
}

async function createRecognizer(vision) {
  const options = {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: "GPU",
    },
    cannedGesturesClassifierOptions: {
      categoryAllowlist: ["Thumb_Up", "Thumb_Down"],
      scoreThreshold: 0.4,
    },
    numHands: 2,
    runningMode: "VIDEO",
  };

  try {
    return await GestureRecognizer.createFromOptions(vision, options);
  } catch (error) {
    console.warn("GPU delegate unavailable, falling back to CPU.", error);
    return GestureRecognizer.createFromOptions(vision, {
      ...options,
      baseOptions: {
        ...options.baseOptions,
        delegate: "CPU",
      },
    });
  }
}

async function openCamera() {
  if (!recognizer) {
    return;
  }

  try {
    submitted = false;
    resetHold();
    stopCamera();

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    video.srcObject = stream;
    await video.play();

    predictWebcam();
  } catch (error) {
    console.error(error);
  }
}

function stopCamera() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }

  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  lastVideoTime = -1;
  stream = undefined;
  video.srcObject = null;
}

function predictWebcam() {
  if (!recognizer || submitted) {
    return;
  }

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const now = performance.now();
      const result = recognizer.recognizeForVideo(video, now);
      updateHoldState(getBestGesture(result.gestures ?? []), now);
    }
  }

  if (!submitted) {
    animationFrameId = requestAnimationFrame(predictWebcam);
  }
}

function updateHoldState(gesture, now) {
  if (!gesture) {
    if (holdGesture && now - holdLastSeenAt <= HOLD_LOST_GRACE_MS) {
      updateHoldProgress(now);
      return;
    }

    resetHold();
    return;
  }

  if (holdGesture?.categoryName !== gesture.categoryName) {
    startHold(gesture, now);
    return;
  }

  holdLastSeenAt = now;
  holdScore = Math.max(holdScore, gesture.score);
  updateHoldProgress(now);
}

function startHold(gesture, now) {
  holdGesture = gesture;
  holdStartedAt = now;
  holdLastSeenAt = now;
  holdScore = gesture.score;

  const feedback = FEEDBACK_BY_GESTURE[gesture.categoryName];
  gestureConfirmation.dataset.gesture = feedback.key;
  thumbMark.textContent = feedback.mark;
  gestureConfirmation.classList.add("is-visible");
  updateHoldProgress(now);
}

function updateHoldProgress(now) {
  if (!holdGesture) {
    return;
  }

  const elapsed = now - holdStartedAt;
  const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
  const secondsLeft = Math.max(Math.ceil((HOLD_DURATION_MS - elapsed) / 1000), 0);
  const feedback = FEEDBACK_BY_GESTURE[holdGesture.categoryName];

  holdRing.style.setProperty("--progress", `${progress * 360}deg`);
  holdLabel.textContent =
    secondsLeft > 0
      ? `Hold for ${secondsLeft} seconds`
      : "Feedback captured";

  if (progress >= 1) {
    completeFeedback();
  }
}

function resetHold() {
  holdGesture = undefined;
  holdStartedAt = 0;
  holdLastSeenAt = 0;
  holdScore = 0;
  holdRing.style.setProperty("--progress", "0deg");
  gestureConfirmation.dataset.gesture = "waiting";
  gestureConfirmation.classList.remove("is-visible");
  thumbMark.textContent = "";
  holdLabel.textContent = "";
}

function completeFeedback() {
  if (!holdGesture || submitted) {
    return;
  }

  submitted = true;
  const feedback = FEEDBACK_BY_GESTURE[holdGesture.categoryName];
  const { feedbackUrl, ...deviceDetails } = hashes ?? {};
  const payload = {
    feedback: feedback.value,
    label: feedback.label,
    gesture: holdGesture.categoryName,
    confidence: Number(holdScore.toFixed(4)),
    heldForMs: HOLD_DURATION_MS,
    collectedAt: new Date().toISOString(),
    deviceDetails
  };

  stopCamera();
  promptPanel.hidden = true;
  cameraStage.hidden = true;
  feedbackChoices.hidden = true;

  thanksPanel.dataset.gesture = feedback.key;
  thanksThumb.textContent = feedback.mark;
  thanksPanel.hidden = false;

  setHash({action: 'close'})

  void sendFeedback(payload);
}

async function sendFeedback(payload) {
  if (!FEEDBACK_POST_URL) {
    console.info("Feedback POST skipped because FEEDBACK_POST_URL is not set.", payload);
    return;
  }

  try {
    const response = await fetch(FEEDBACK_POST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Feedback POST failed with status ${response.status}`);
    }
  } catch (error) {
    console.warn("Unable to send feedback.", error);
  }
}

function getBestGesture(gestureLists) {
  return gestureLists
    .flat()
    .filter(({ categoryName }) =>
      Object.prototype.hasOwnProperty.call(FEEDBACK_BY_GESTURE, categoryName),
    )
    .sort((first, second) => second.score - first.score)[0];
}


function getHashes() {
  if (!location.hash) return;
  const hashString = location.hash.split("#").slice(1).join("#");

  try {
    return JSON.parse(atob(hashString));
  } catch (error) {
    console.warn("Unable to parse hash parameters.", error);
    return;
  }
}



function setHash(params={}) {
  const hashes = {}
  for (const key in params) {
    if (params.hasOwnProperty(key)) {
      hashes[key] = params[key];
    }
  }
  window.location.hash = "#" + btoa(JSON.stringify(hashes));
  
}