import {
  buildCustomPayloadPreview,
  buildFeedbackMarkdown,
  buildSnippet,
  clampHoldSeconds,
  injectConfig,
  normalizeSeconds,
  parseConfig,
  WEBEX_API_BASE,
} from "./snippet.js";

const config = window.APP_CONFIG ?? {};

// The macro source is published alongside the wizard on GitHub Pages so the
// wizard can both parse it for defaults and, on "Download macro", inject the
// configured values into a fresh copy.
const MACRO_SOURCE_URL = "../macro/byod-feedback.js";

// Used if the macro source can't be fetched or parsed (e.g. offline, or the
// wizard is hosted separately from the macro). Mirrors macro/byod-feedback.js.
const FALLBACK_CONFIG = {
  messagePrompt: "Were you satisfied with this Meeting Room Experience?",
  webAppUrl: config.webappUrl || "https://wxsd-sales.github.io/byod-feedback-webapp/webapp",
  feedback: {
    destination: "custom",
    url: "https://your-backend.example.com/feedback",
    apiKey: "your-api-key",
    webex: {
      botAccessToken: "your-bot-access-token",
      target: "room",
      roomId: "",
      toPersonEmail: "",
    },
  },
  timers: {
    autoCloseSeconds: 60,
    emptyRoomAutoCloseSeconds: 10,
    meetingDurationSeconds: 180,
    gestureHoldSeconds: 5,
  },
  debug: true,
};

/* Header: product name and source-code link derived from APP_CONFIG. */
(function initHeader() {
  const product = document.getElementById("app-product");
  const sourceLink = document.getElementById("source-link");

  if (product && config.title) {
    product.textContent = `${config.title} - Configuration Wizard`;
  }
  if (config.title) {
    document.title = `${config.title} - Wizard`;
  }
  if (sourceLink && config.repoUrl) {
    sourceLink.href = config.repoUrl;
  }
})();

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

/* Settings form -> live macro config snippet + macro download. */
(function initSettings() {
  const messagePromptInput = document.getElementById("message-prompt");
  const webappUrlInput = document.getElementById("webapp-url");
  const autoCloseSecondsInput = document.getElementById("auto-close-seconds");
  const emptyRoomAutoCloseSecondsInput = document.getElementById(
    "empty-room-auto-close-seconds",
  );
  const meetingDurationSecondsInput = document.getElementById(
    "meeting-duration-seconds",
  );
  const gestureHoldSecondsInput = document.getElementById(
    "gesture-hold-seconds",
  );
  const debugEnabledInput = document.getElementById("debug-enabled");

  const feedbackDestinationSelect = document.getElementById(
    "feedback-destination",
  );
  const customBackendPanel = document.getElementById("custom-backend-panel");
  const webexPanel = document.getElementById("webex-panel");

  const feedbackUrlInput = document.getElementById("feedback-url");
  const feedbackApiKeyInput = document.getElementById("feedback-api-key");
  const customPayloadPreview = document.getElementById(
    "custom-payload-preview",
  );

  const webexTargetSelect = document.getElementById("webex-target");
  const webexBotTokenInput = document.getElementById("webex-bot-token");
  const webexBotTokenToggle = document.getElementById(
    "webex-bot-token-toggle",
  );
  const webexBotTokenStatus = document.getElementById(
    "webex-bot-token-status",
  );
  const webexRoomSearchField = document.getElementById(
    "webex-room-search-field",
  );
  const webexRoomSearchInput = document.getElementById("webex-room-search");
  const webexRoomSearchHint = document.getElementById(
    "webex-room-search-hint",
  );
  const webexRoomResults = document.getElementById("webex-room-results");
  const webexPersonSearchField = document.getElementById(
    "webex-person-search-field",
  );
  const webexPersonSearchInput = document.getElementById(
    "webex-person-search",
  );
  const webexPersonSearchHint = document.getElementById(
    "webex-person-search-hint",
  );
  const webexPersonResults = document.getElementById("webex-person-results");
  const webexSelectedTarget = document.getElementById("webex-selected-target");
  const webexSelectedTargetName = document.getElementById(
    "webex-selected-target-name",
  );
  const webexSelectedTargetClear = document.getElementById(
    "webex-selected-target-clear",
  );
  const webexTargetStatus = document.getElementById("webex-target-status");
  const webexMessagePreview = document.getElementById(
    "webex-message-preview",
  );

  const macroLoadStatus = document.getElementById("macro-load-status");
  const output = document.getElementById("output");
  const copyButton = document.getElementById("copy-button");
  const downloadButton = document.getElementById("download-button");
  const exportStatus = document.getElementById("export-status");
  const form = document.getElementById("wizard-form");

  if (
    !messagePromptInput ||
    !webappUrlInput ||
    !autoCloseSecondsInput ||
    !emptyRoomAutoCloseSecondsInput ||
    !meetingDurationSecondsInput ||
    !gestureHoldSecondsInput ||
    !debugEnabledInput ||
    !feedbackDestinationSelect ||
    !customBackendPanel ||
    !webexPanel ||
    !feedbackUrlInput ||
    !feedbackApiKeyInput ||
    !webexTargetSelect ||
    !webexBotTokenInput ||
    !output ||
    !form
  ) {
    return;
  }

  // Fields whose values must be whole, non-negative numbers of seconds.
  const NUMBER_FIELDS = [
    autoCloseSecondsInput,
    emptyRoomAutoCloseSecondsInput,
    meetingDurationSecondsInput,
    gestureHoldSecondsInput,
  ];

  // Cache of the fetched macro source, reused by the download action so it
  // isn't re-fetched on every click.
  let macroSource = null;

  // The room or person the user has resolved via search, e.g.
  // { type: "room", id, title } or { type: "person", id, email, displayName }.
  let selectedWebexTarget = null;

  // Rooms are listed once per access token and filtered client-side as the
  // user types (the List Rooms API has no text-search parameter).
  let roomsCache = null; // { token, rooms }

  const setStatus = (statusEl, message, kind = "") => {
    if (!statusEl) return;
    statusEl.textContent = message;
    if (kind) {
      statusEl.dataset.kind = kind;
    } else {
      delete statusEl.dataset.kind;
    }
  };

  const setExportStatus = (message, kind = "") =>
    setStatus(exportStatus, message, kind);

  // Maps each natively-validated input to the status element that should
  // show its browser constraint-validation message (required / type=url /
  // min / max...).
  const FIELD_STATUS = new Map([
    [messagePromptInput, document.getElementById("message-prompt-status")],
    [webappUrlInput, document.getElementById("webapp-url-status")],
    [feedbackUrlInput, document.getElementById("feedback-url-status")],
    [webexBotTokenInput, webexBotTokenStatus],
    [
      autoCloseSecondsInput,
      document.getElementById("auto-close-seconds-status"),
    ],
    [
      emptyRoomAutoCloseSecondsInput,
      document.getElementById("empty-room-auto-close-seconds-status"),
    ],
    [
      meetingDurationSecondsInput,
      document.getElementById("meeting-duration-seconds-status"),
    ],
    [
      gestureHoldSecondsInput,
      document.getElementById("gesture-hold-seconds-status"),
    ],
  ]);

  const validateField = (input) => {
    const statusEl = FIELD_STATUS.get(input);
    const valid = input.checkValidity();
    input.setAttribute("aria-invalid", String(!valid));
    setStatus(statusEl, valid ? "" : input.validationMessage, "error");
    return valid;
  };

  // The selected Webex room/person isn't backed by a single input (it's
  // resolved via search), so it gets its own validity check alongside the
  // native ones.
  const validateWebexTarget = () => {
    if (feedbackDestinationSelect.value !== "webex") {
      setStatus(webexTargetStatus, "");
      return true;
    }
    if (selectedWebexTarget) {
      setStatus(webexTargetStatus, "");
      return true;
    }
    const kind = webexTargetSelect.value === "person" ? "person" : "space";
    setStatus(webexTargetStatus, `Search and select a ${kind} above.`, "error");
    return false;
  };

  const validateAll = () => {
    let allValid = true;
    for (const input of FIELD_STATUS.keys()) {
      if (!validateField(input)) allValid = false;
    }
    if (!validateWebexTarget()) allValid = false;
    return allValid;
  };

  // Strips anything that isn't a digit as the user types, so numeric fields
  // can only ever hold a non-negative whole number (or be empty).
  const restrictToDigits = (input) => {
    input.addEventListener("input", () => {
      const digitsOnly = input.value.replace(/[^0-9]/g, "");
      if (digitsOnly !== input.value) {
        input.value = digitsOnly;
      }
      refreshAll();
    });
  };

  // Auto-corrects the gesture hold time back into its valid 1-30 range as
  // soon as the field loses focus, rather than just flagging it as invalid.
  gestureHoldSecondsInput.addEventListener("blur", () => {
    if (gestureHoldSecondsInput.value === "") return;
    const clamped = clampHoldSeconds(gestureHoldSecondsInput.value);
    if (String(clamped) !== gestureHoldSecondsInput.value) {
      gestureHoldSecondsInput.value = String(clamped);
      refreshAll();
    }
  });

  const getValues = () => ({
    messagePrompt: messagePromptInput.value.trim(),
    webAppUrl: webappUrlInput.value.trim(),
    feedbackDestination: feedbackDestinationSelect.value,
    feedbackUrl: feedbackUrlInput.value.trim(),
    feedbackApiKey: feedbackApiKeyInput.value.trim(),
    webexBotAccessToken: webexBotTokenInput.value.trim(),
    webexTarget: webexTargetSelect.value,
    webexRoomId:
      selectedWebexTarget?.type === "room" ? selectedWebexTarget.id : "",
    webexToPersonEmail:
      selectedWebexTarget?.type === "person"
        ? selectedWebexTarget.email ?? ""
        : "",
    autoCloseSeconds: normalizeSeconds(autoCloseSecondsInput.value, 0),
    emptyRoomAutoCloseSeconds: normalizeSeconds(
      emptyRoomAutoCloseSecondsInput.value,
      0,
    ),
    meetingDurationSeconds: normalizeSeconds(
      meetingDurationSecondsInput.value,
      0,
    ),
    gestureHoldSeconds: clampHoldSeconds(gestureHoldSecondsInput.value),
    debug: debugEnabledInput.checked,
  });

  // Toggles which destination panel is shown and which fields are actually
  // required, so a hidden panel's empty fields never block validation.
  const updateDestinationRequirements = () => {
    const isCustom = feedbackDestinationSelect.value === "custom";
    customBackendPanel.hidden = !isCustom;
    webexPanel.hidden = isCustom;
    feedbackUrlInput.required = isCustom;
    webexBotTokenInput.required = !isCustom;
  };

  const updateTargetFields = () => {
    const isPerson = webexTargetSelect.value === "person";
    webexRoomSearchField.hidden = isPerson;
    webexPersonSearchField.hidden = !isPerson;
  };

  const clearSelectedTarget = () => {
    selectedWebexTarget = null;
    webexSelectedTarget.hidden = true;
    updateTargetFields();
    webexRoomSearchInput.value = "";
    webexPersonSearchInput.value = "";
    renderResults(webexRoomResults, []);
    renderResults(webexPersonResults, []);
  };

  const showSelectedTarget = () => {
    if (!selectedWebexTarget) {
      webexSelectedTarget.hidden = true;
      return;
    }
    webexSelectedTargetName.textContent =
      selectedWebexTarget.type === "room"
        ? selectedWebexTarget.title
        : selectedWebexTarget.email
          ? `${selectedWebexTarget.displayName} (${selectedWebexTarget.email})`
          : selectedWebexTarget.displayName;
    webexSelectedTarget.hidden = false;
    webexRoomSearchField.hidden = true;
    webexPersonSearchField.hidden = true;
  };

  const selectTarget = (target) => {
    selectedWebexTarget = target;
    showSelectedTarget();
    refreshAll();
  };

  webexSelectedTargetClear.addEventListener("click", () => {
    clearSelectedTarget();
    refreshAll();
  });

  webexTargetSelect.addEventListener("change", () => {
    clearSelectedTarget();
    refreshAll();
  });

  // --- Webex search --------------------------------------------------

  function describeWebexError(error) {
    if (error?.status === 401) return "That access token was rejected.";
    if (error?.status === 403)
      return "That token doesn't have permission to do this.";
    return "Could not reach the Webex API. Check the token and your connection.";
  }

  async function webexFetch(path, token) {
    const response = await fetch(`${WEBEX_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const error = new Error(`Webex API error (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  // Renders a list of {icon, title, subtitle, onSelect} rows into a results
  // container, or a message row when `message` is given instead.
  function renderResults(container, rows, message) {
    container.textContent = "";
    if (message) {
      const empty = document.createElement("div");
      empty.className = "search-result search-result--empty";
      empty.textContent = message;
      container.appendChild(empty);
      container.hidden = false;
      return;
    }
    if (!rows.length) {
      container.hidden = true;
      return;
    }
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";

      const icon = document.createElement("span");
      icon.className = `search-result__icon icon ${row.icon}`;
      icon.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = "search-result__text";

      const title = document.createElement("span");
      title.className = "search-result__title";
      title.textContent = row.title;

      const subtitle = document.createElement("span");
      subtitle.className = "search-result__subtitle";
      subtitle.textContent = row.subtitle;

      text.append(title, subtitle);
      button.append(icon, text);
      button.addEventListener("click", row.onSelect);
      container.appendChild(button);
    }
    container.hidden = false;
  }

  async function ensureRoomsLoaded(token) {
    if (roomsCache && roomsCache.token === token) return roomsCache.rooms;
    const data = await webexFetch(
      "/rooms?max=100&sortBy=lastactivity&type=group",
      token,
    );
    roomsCache = { token, rooms: data.items ?? [] };
    return roomsCache.rooms;
  }

  const handleRoomSearch = debounce(async () => {
    const token = webexBotTokenInput.value.trim();
    if (!token) return;
    const query = webexRoomSearchInput.value.trim().toLowerCase();
    renderResults(webexRoomResults, [], "Searching…");
    try {
      const rooms = await ensureRoomsLoaded(token);
      const matches = (
        query ? rooms.filter((r) => r.title?.toLowerCase().includes(query)) : rooms
      ).slice(0, 8);
      if (!matches.length) {
        renderResults(webexRoomResults, [], "No matching spaces found.");
        return;
      }
      renderResults(
        webexRoomResults,
        matches.map((room) => ({
          icon: "icon-chat-group-regular",
          title: room.title,
          subtitle: room.type === "direct" ? "Direct message" : "Space",
          onSelect: () =>
            selectTarget({ type: "room", id: room.id, title: room.title }),
        })),
      );
    } catch (error) {
      roomsCache = null;
      renderResults(webexRoomResults, [], describeWebexError(error));
    }
  }, 250);

  const handlePersonSearch = debounce(async () => {
    const token = webexBotTokenInput.value.trim();
    const query = webexPersonSearchInput.value.trim();
    if (!token || query.length < 2) {
      renderResults(webexPersonResults, []);
      return;
    }
    renderResults(webexPersonResults, [], "Searching…");
    try {
      const param = query.includes("@")
        ? `email=${encodeURIComponent(query)}`
        : `displayName=${encodeURIComponent(query)}`;
      const data = await webexFetch(`/people?${param}&max=10`, token);
      const people = data.items ?? [];
      if (!people.length) {
        renderResults(webexPersonResults, [], "No matching people found.");
        return;
      }
      renderResults(
        webexPersonResults,
        people.map((person) => ({
          icon: "icon-user-regular",
          title: person.displayName || person.emails?.[0] || "Unknown",
          subtitle: person.emails?.[0] ?? "",
          onSelect: () =>
            selectTarget({
              type: "person",
              id: person.id,
              email: person.emails?.[0] ?? "",
              displayName: person.displayName || person.emails?.[0],
            }),
        })),
      );
    } catch (error) {
      renderResults(webexPersonResults, [], describeWebexError(error));
    }
  }, 400);

  const updateSearchAvailability = () => {
    const hasToken = webexBotTokenInput.value.trim().length > 0;
    webexRoomSearchInput.disabled = !hasToken;
    webexPersonSearchInput.disabled = !hasToken;
    webexRoomSearchHint.textContent = hasToken
      ? "Showing the 100 most recently active spaces this bot is in."
      : "Enter a bot access token above to search the spaces it's a member of.";
    webexPersonSearchHint.textContent = hasToken
      ? "Type a name, or a full email address for an exact match."
      : "Enter a bot access token above to search for a person.";
    if (!hasToken) {
      roomsCache = null;
      renderResults(webexRoomResults, []);
      renderResults(webexPersonResults, []);
    }
  };

  webexBotTokenInput.addEventListener("input", () => {
    roomsCache = null;
    updateSearchAvailability();
    refreshAll();
  });

  webexBotTokenToggle.addEventListener("click", () => {
    const revealed = webexBotTokenInput.type === "text";
    webexBotTokenInput.type = revealed ? "password" : "text";
    webexBotTokenToggle.setAttribute("aria-pressed", String(!revealed));
    webexBotTokenToggle.setAttribute(
      "aria-label",
      revealed ? "Show access token" : "Hide access token",
    );
    webexBotTokenToggle.querySelector(".icon").className = revealed
      ? "icon icon-show-regular"
      : "icon icon-hide-regular";
  });

  webexRoomSearchInput.addEventListener("input", handleRoomSearch);
  webexPersonSearchInput.addEventListener("input", handlePersonSearch);

  // --- Previews --------------------------------------------------------

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function inlineMarkdown(text) {
    return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  // Renders the small subset of Webex markdown this message actually uses
  // (bold, bullet lists, "---" dividers) as HTML for the chat-bubble mockup.
  function renderMarkdownPreview(markdown) {
    let html = "";
    let inList = false;
    const closeList = () => {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
    };
    for (const line of markdown.split("\n")) {
      if (line.trim() === "---") {
        closeList();
        html += "<hr>";
      } else if (line.startsWith("- ")) {
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        html += `<li>${inlineMarkdown(escapeHtml(line.slice(2)))}</li>`;
      } else if (line.trim() === "") {
        closeList();
      } else {
        closeList();
        html += `<p>${inlineMarkdown(escapeHtml(line))}</p>`;
      }
    }
    closeList();
    return html;
  }

  const renderWebexMessagePreview = () => {
    // Sample data - this message's content doesn't depend on any wizard
    // field (the macro fills it in from the live session at send time).
    webexMessagePreview.innerHTML = renderMarkdownPreview(
      buildFeedbackMarkdown(),
    );
  };

  const updateCustomPayloadPreview = () => {
    const lines = buildCustomPayloadPreview({
      url: feedbackUrlInput.value.trim(),
      apiKey: feedbackApiKeyInput.value.trim(),
    });
    customPayloadPreview.innerHTML = lines
      .map((line) =>
        line.omitted
          ? `<del class="code-omitted">${escapeHtml(line.text)}</del> <span class="code-comment">// ${escapeHtml(line.note)}</span>`
          : escapeHtml(line.text),
      )
      .join("\n");
  };

  const applyValues = (values) => {
    messagePromptInput.value = values.messagePrompt ?? "";
    webappUrlInput.value = values.webAppUrl ?? "";
    feedbackDestinationSelect.value =
      values.feedback?.destination === "webex" ? "webex" : "custom";
    feedbackUrlInput.value = values.feedback?.url ?? "";
    feedbackApiKeyInput.value = values.feedback?.apiKey ?? "";
    webexBotTokenInput.value = values.feedback?.webex?.botAccessToken ?? "";
    webexTargetSelect.value =
      values.feedback?.webex?.target === "person" ? "person" : "room";

    const roomId = values.feedback?.webex?.roomId;
    const toPersonEmail = values.feedback?.webex?.toPersonEmail;
    if (webexTargetSelect.value === "person" && toPersonEmail) {
      selectedWebexTarget = {
        type: "person",
        id: "",
        email: toPersonEmail,
        displayName: toPersonEmail,
      };
    } else if (webexTargetSelect.value === "room" && roomId) {
      selectedWebexTarget = { type: "room", id: roomId, title: roomId };
    } else {
      selectedWebexTarget = null;
    }

    autoCloseSecondsInput.value = String(
      normalizeSeconds(values.timers?.autoCloseSeconds, 60),
    );
    emptyRoomAutoCloseSecondsInput.value = String(
      normalizeSeconds(values.timers?.emptyRoomAutoCloseSeconds, 10),
    );
    meetingDurationSecondsInput.value = String(
      normalizeSeconds(values.timers?.meetingDurationSeconds, 180),
    );
    gestureHoldSecondsInput.value = String(
      clampHoldSeconds(values.timers?.gestureHoldSeconds, 5),
    );
    debugEnabledInput.checked = Boolean(values.debug);

    updateDestinationRequirements();
    updateTargetFields();
    updateSearchAvailability();
    showSelectedTarget();
  };

  const refreshAll = () => {
    updateDestinationRequirements();
    const valid = validateAll();
    // Assign via textContent (never innerHTML) so user input is treated as text.
    output.textContent = buildSnippet(getValues());
    updateCustomPayloadPreview();
    if (copyButton) copyButton.disabled = !valid;
    if (downloadButton) downloadButton.disabled = !valid;
  };

  [messagePromptInput, webappUrlInput, feedbackApiKeyInput].forEach((input) =>
    input.addEventListener("input", refreshAll),
  );
  feedbackUrlInput.addEventListener("input", refreshAll);
  NUMBER_FIELDS.forEach(restrictToDigits);
  debugEnabledInput.addEventListener("change", refreshAll);
  feedbackDestinationSelect.addEventListener("change", refreshAll);

  // Attempts to show a friendly name for a room/person that was already
  // configured in the macro (before the wizard re-fetched it), falling back
  // to the raw id/email that's already shown if the lookup fails.
  const resolveSelectedTargetLabel = async () => {
    if (!selectedWebexTarget) return;
    const token = webexBotTokenInput.value.trim();
    if (!token) return;
    try {
      if (selectedWebexTarget.type === "room") {
        const room = await webexFetch(
          `/rooms/${encodeURIComponent(selectedWebexTarget.id)}`,
          token,
        );
        selectedWebexTarget = {
          type: "room",
          id: room.id,
          title: room.title,
        };
      } else {
        const data = await webexFetch(
          `/people?email=${encodeURIComponent(selectedWebexTarget.email)}`,
          token,
        );
        const person = data.items?.[0];
        if (person) {
          selectedWebexTarget = {
            type: "person",
            id: person.id,
            email: selectedWebexTarget.email,
            displayName: person.displayName,
          };
        }
      }
      showSelectedTarget();
    } catch {
      // Keep showing the raw id/email already populated by applyValues().
    }
  };

  (async function loadDefaults() {
    try {
      const response = await fetch(MACRO_SOURCE_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      macroSource = await response.text();
      applyValues(parseConfig(macroSource));
      setStatus(macroLoadStatus, "");
    } catch {
      macroSource = null;
      applyValues(FALLBACK_CONFIG);
      setStatus(
        macroLoadStatus,
        "Could not load macro/byod-feedback.js, showing built-in defaults instead. " +
          "“Download macro” will retry the fetch.",
        "warning",
      );
    }
    renderWebexMessagePreview();
    refreshAll();
    resolveSelectedTargetLabel().then(refreshAll);
  })();

  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(output.textContent);
      } catch {
        setExportStatus(
          "Clipboard access was blocked by the browser.",
          "error",
        );
        return;
      }

      const label = copyButton.querySelector(".icon-button__label");
      const icon = copyButton.querySelector(".icon");
      const previousLabel = label.textContent;

      label.textContent = "Copied";
      icon.classList.remove("icon-copy-bold");
      icon.classList.add("icon-check-circle-bold");

      window.setTimeout(() => {
        label.textContent = previousLabel;
        icon.classList.remove("icon-check-circle-bold");
        icon.classList.add("icon-copy-bold");
      }, 1600);
    });
  }

  if (downloadButton) {
    downloadButton.addEventListener("click", async () => {
      setExportStatus("");

      if (!validateAll()) {
        setExportStatus(
          "Fix the highlighted fields before downloading.",
          "error",
        );
        return;
      }

      let source = macroSource;
      if (!source) {
        try {
          const response = await fetch(MACRO_SOURCE_URL, { cache: "no-store" });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          source = await response.text();
          macroSource = source;
        } catch {
          setExportStatus(
            "Could not load the macro source. Use Copy config instead.",
            "error",
          );
          return;
        }
      }

      let macro;
      try {
        macro = injectConfig(source, getValues());
      } catch {
        setExportStatus(
          "The macro source is missing its CONFIG markers.",
          "error",
        );
        return;
      }

      const fileName = "byod-feedback.js";
      const blob = new Blob([macro], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportStatus(`Downloaded ${fileName}.`, "success");
    });
  }
})();

/*
 * Theme selector: toggles the menu and applies System / Light / Dark themes.
 * Light/Dark persist via the URL hash (read by the inline boot script), while
 * System clears the hash and follows the OS preference.
 */
(function initThemeSelect() {
  const root = document.documentElement;
  const select = document.getElementById("theme-select");
  const button = document.getElementById("theme-select-button");
  const menu = document.getElementById("theme-select-menu");
  const label = document.getElementById("theme-select-label");
  const currentIcon = document.getElementById("theme-select-current-icon");

  if (!select || !button || !menu || !label || !currentIcon) {
    return;
  }

  const options = Array.from(menu.querySelectorAll(".theme-select-option"));

  const META = {
    system: { label: "System", icon: "icon-laptop-regular" },
    light: { label: "Light", icon: "icon-brightness-high-filled" },
    dark: { label: "Dark", icon: "icon-quiet-hours-presence-filled" },
  };
  const ICON_CLASSES = Object.values(META).map((meta) => meta.icon);

  const readChoice = () => {
    const raw = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const theme = raw ? new URLSearchParams(raw).get("theme") : null;
    return theme === "light" || theme === "dark" ? theme : "system";
  };

  const applyTheme = (choice) => {
    const dark =
      choice === "dark" ||
      (choice === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.classList.remove(
      "mds-theme-stable-lightWebex",
      "mds-theme-stable-darkWebex",
    );
    root.classList.add(
      dark ? "mds-theme-stable-darkWebex" : "mds-theme-stable-lightWebex",
    );
    root.style.colorScheme = dark ? "dark" : "light";
  };

  const syncButton = (choice) => {
    const meta = META[choice] || META.system;
    label.textContent = meta.label;
    currentIcon.classList.remove(...ICON_CLASSES);
    currentIcon.classList.add(meta.icon);
    options.forEach((option) => {
      option.setAttribute(
        "aria-selected",
        String(option.dataset.themeChoice === choice),
      );
    });
  };

  const setChoice = (choice) => {
    if (choice === "system") {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    } else {
      window.location.hash = "theme=" + choice;
    }
    applyTheme(choice);
    syncButton(choice);
  };

  const openMenu = () => {
    menu.hidden = false;
    select.dataset.open = "true";
    button.setAttribute("aria-expanded", "true");
  };

  const closeMenu = () => {
    menu.hidden = true;
    select.dataset.open = "false";
    button.setAttribute("aria-expanded", "false");
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.hidden) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  options.forEach((option) => {
    option.addEventListener("click", () => {
      setChoice(option.dataset.themeChoice);
      closeMenu();
      button.focus();
    });
  });

  document.addEventListener("click", (event) => {
    if (!select.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      closeMenu();
      button.focus();
    }
  });

  syncButton(readChoice());
})();

/* Tab list: toggles which panel is visible. */
(function initTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  if (!tabs.length) {
    return;
  }

  const activate = (tab) => {
    tabs.forEach((current) => {
      const selected = current === tab;
      current.setAttribute("aria-selected", String(selected));
      current.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(current.dataset.tabTarget);
      if (panel) {
        panel.hidden = !selected;
      }
    });
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
        return;
      }
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      next.focus();
      activate(next);
    });
  });
})();
