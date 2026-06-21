const $ = (selector) => document.querySelector(selector);
const panels = ["#open-panel", "#consent-panel", "#record-panel", "#done-panel"];
let gate;
let recorder;
let chunks = [];
let recording;
let timer;
let startedAt;

function show(selector) {
  panels.forEach((item) => $(item).classList.toggle("hidden", item !== selector));
}

async function loadGate(demoHour = new URLSearchParams(location.search).get("demoHour")) {
  const suffix = demoHour === null || demoHour === "" ? "" : `?demoHour=${demoHour}`;
  gate = await fetch(`/api/time-gate${suffix}`).then((response) => response.json());
  $("#status-label").textContent = gate.demoOverride ? "Demo time active" : "Singapore time checked";
  if (gate.mode === "open") {
    $("#title").textContent = "A live officer is available";
    $("#message").textContent = "The ComCare hotline is open daily from 7am to midnight.";
    show("#open-panel");
  } else {
    $("#title").textContent = "SilverArch has answered";
    $("#message").textContent = "The live hotline is closed. You can leave a voice account for next-day review.";
    show("#consent-panel");
  }
}

$("#consent").addEventListener("change", (event) => $("#continue").disabled = !event.target.checked);
$("#continue").addEventListener("click", () => show("#record-panel"));
$("#record").addEventListener("click", async () => {
  if (recorder?.state === "recording") {
    recorder.stop();
    clearInterval(timer);
    $("#record").classList.remove("active");
    $("#record-status").textContent = "Recording ready. Send it when you are comfortable.";
    $("#submit").classList.remove("hidden");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => {
      recording = new Blob(chunks, { type: recorder.mimeType });
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.start();
    startedAt = Date.now();
    timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      $("#timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    }, 250);
    $("#record").classList.add("active");
    $("#record-status").textContent = "Recording… tap again when done.";
  } catch {
    $("#record-status").textContent = "Microphone access is needed to record your account.";
  }
});

$("#submit").addEventListener("click", async () => {
  $("#submit").disabled = true;
  $("#record-status").textContent = "Sending securely…";
  const response = await fetch("/api/cases", {
    method: "POST",
    headers: { "content-type": recording.type, ...(gate.demoOverride && { "x-demo-override": "after-hours" }) },
    body: recording
  });
  const body = await response.json();
  if (!response.ok) {
    $("#record-status").textContent = body.error || "The recording could not be sent.";
    $("#submit").disabled = false;
    return;
  }
  if (body.urgency?.urgent) {
    $("#done-panel h2").textContent = "Please get help now";
    $("#done-panel p").innerHTML = `Your recording was received, but it may describe an immediate safety risk. Contact <strong>${body.urgency.resource}</strong> now rather than waiting for next-day review.`;
  }
  show("#done-panel");
});

document.querySelectorAll("[data-hour]").forEach((button) => button.addEventListener("click", () => {
  const hour = button.dataset.hour;
  history.replaceState({}, "", hour ? `?demoHour=${hour}` : location.pathname);
  loadGate(hour);
}));

loadGate();
