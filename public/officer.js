const $ = (selector) => document.querySelector(selector);
let cases = [];

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const formatTime = (seconds = 0) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const languageLabel = (code = "en") => ({ en: "English", zh: "Mandarin Chinese", ms: "Malay", ta: "Tamil" }[code] || code || "Not recorded");
let autoSaveTimer;
const waiting = (iso) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};

function renderList() {
  $("#case-count").textContent = cases.length;
  $("#urgent-count").textContent = cases.filter((item) => item.urgency?.urgent).length;
  $("#review-count").textContent = cases.filter((item) => item.status === "needs-review").length;
  const statusFilter = $("#filter-status")?.value || "all";
  const reasonFilter = $("#filter-reason")?.value || "all";
  const visibleCases = cases.filter((item) => statusFilter === "all" || item.status === statusFilter).filter((item) => {
    if (reasonFilter === "all") return true;
    if (reasonFilter === "urgent") return item.urgency?.urgent;
    if (reasonFilter === "translation") return ["pending", "unavailable", "failed"].includes(item.translation?.status);
    if (reasonFilter === "missing") return item.triage?.shortlist?.some((scheme) => scheme.insufficientInformation?.length);
    if (reasonFilter === "pii") return item.piiProposals?.some((proposal) => proposal.status === "proposed");
    if (reasonFilter === "confidence") return item.transcript?.confidenceFlags?.length;
    return true;
  });
  $("#case-list").innerHTML = visibleCases.length ? visibleCases.map((item) => `
    <button class="case-card ${item.urgency?.urgent ? "urgent" : ""}" data-id="${item.id}">
      <span><strong>${item.urgency?.urgent ? "Urgent risk" : "Voice intake"}</strong><small>${new Date(item.createdAt).toLocaleString("en-SG")}</small></span>
      <span><em>${waiting(item.createdAt)}</em><small>${item.transcript.asrEngine || "ASR failed"}${item.translation?.status === "ready" ? ` · ${item.translation.provider}` : item.translation?.status === "unavailable" ? " · translation unavailable" : ""}</small></span>
    </button>`).join("") : '<div class="empty-card"><strong>No matching cases</strong><p>Adjust the filters or submit a demo recording.</p></div>';
  document.querySelectorAll(".case-card").forEach((button) => button.addEventListener("click", () => renderDetail(button.dataset.id)));
}

function renderDetail(id) {
  const item = cases.find((entry) => entry.id === id);
  const flags = [
    ...(item.urgency?.urgent ? [{ kind: "urgent", text: `${item.urgency.reason}: ${item.urgency.resource}` }] : []),
    ...(item.reviewReasons || []).map((text) => ({ kind: "confidence", text })),
    ...(item.piiProposals || []).filter((proposal) => proposal.status === "proposed").map((proposal) => ({ kind: "pii", text: `${proposal.type} needs officer confirmation` }))
  ];
  const evidence = item.evidence || [];
  const primaryTranscript = evidenceDisplayTranscript(item);
  const words = primaryTranscript.words;
  const evidenceForWord = (index) => primaryTranscript.highlightEvidence && evidence.find((fact) => index >= fact.startWord && index <= fact.endWord);
  const transcriptHtml = words.length ? words.map((word, index) => {
    const marker = evidenceForWord(index);
    const classes = marker ? `word seek-audio evidence-word evidence-${marker.category}` : "word seek-audio";
    const title = marker ? `${marker.label} · exact phrase ${Number(word.start || 0).toFixed(1)}s` : `Play from ${Number(word.start || 0).toFixed(1)}s`;
    return `<button class="${classes}" data-start="${marker ? Number(marker.sentenceStart) || 0 : Number(word.start) || 0}" title="${escapeHtml(title)}">${escapeHtml(word.text)}</button>`;
  }).join(" ") : escapeHtml(primaryTranscript.text || "No transcript available. Review the raw audio.");
  const originalWords = item.transcript.words || item.transcript.segments || [];
  const originalHtml = originalWords.length ? originalWords.map((word) => `<button class="word seek-audio" data-start="${Number(word.start) || 0}" title="Play from ${Number(word.start || 0).toFixed(1)}s">${escapeHtml(word.text)}</button>`).join(" ") : escapeHtml(item.transcript.text || "No original transcript available.");
  const shortlist = item.triage?.shortlist || [];
  const profile = item.callerProfile || { summary: "This case predates automatic evidence extraction.", characteristics: [], missingCoreDetails: [] };
  const duration = Math.max(Number(item.audioDurationMs || 0) / 1000, ...words.map((word) => Number(word.end) || 0), 0);
  const piiControls = (item.piiProposals || []).map((proposal, index) => `<article class="pii-review"><div><strong>${escapeHtml(proposal.type)}</strong><span>${escapeHtml(proposal.value)}</span><small>${escapeHtml(proposal.status)}</small></div>${proposal.status === "proposed" ? `<button class="secondary" data-pii-index="${index}" data-pii-status="confirmed">Confirm</button><button class="secondary" data-pii-index="${index}" data-pii-status="rejected">Reject</button>` : ""}</article>`).join("");
  const facts = item.triage?.officerFacts || item.triage?.extractedFacts || {};
  const editableFacts = [["citizenship", "Citizenship"], ["applicantAge", "Applicant age"], ["householdIncome", "Household income"], ["householdSize", "Household size"], ["employment", "Employment"]];
  const readiness = item.reportReadiness || { ready: false, missing: [{ label: "Save the officer review to check report readiness" }] };
  const factReviewHtml = editableFacts.map(([key, label]) => { const review = item.factReviews?.[key] || {}; const initialValue = review.value ?? facts[key] ?? ""; return `<article class="fact-review" data-fact-review="${key}"><label>${label}<input data-fact-value="${key}" value="${escapeHtml(initialValue)}"></label><label>Review outcome<select data-fact-status="${key}"><option value="" ${!review.status ? "selected" : ""}>Select…</option><option value="verified" ${review.status === "verified" ? "selected" : ""}>Verified</option><option value="unknown" ${review.status === "unknown" ? "selected" : ""}>Unable to verify / not provided</option></select></label><label class="fact-explanation ${review.status === "unknown" ? "" : "hidden"}" data-fact-explanation-wrap="${key}">Explanation<input data-fact-explanation="${key}" value="${escapeHtml(review.explanation || "")}"></label></article>`; }).join("");
  const reportAction = item.reportSummary ? `<a class="primary button" href="/report.html?case=${encodeURIComponent(item.id)}">${item.reportSummary.status === "finalized" ? "View finalized report" : "Continue report draft"}</a>` : `<button id="generate-report" class="primary" ${readiness.ready ? "" : "disabled"}>Generate report</button>`;
  $("#case-detail").className = "detail";
  $("#case-detail").innerHTML = `
    <div class="detail-head"><div><p class="eyebrow">Case ${item.id.slice(0, 8)}</p><h2>Citizen testimony</h2></div><span class="badge">${escapeHtml(item.status)}</span></div>
    ${item.audioUrl ? `<audio id="case-audio" preload="metadata" src="${item.audioUrl}"></audio><div class="audio-player"><button id="audio-toggle" class="audio-toggle" aria-label="Play recording">▶</button><span id="audio-current">00:00</span><input id="audio-slider" type="range" min="0" max="${duration}" step="0.01" value="0" aria-label="Recording position"><span>${formatTime(duration)}</span></div>` : '<div class="pending">Fixed transcript fixture — no synthetic citizen audio is attached.</div>'}
    <section class="contact-card"><div><span>SSO callback number</span><strong>${escapeHtml(item.contact?.phone || "Not collected")}</strong></div><div><span>Intake language</span><strong>${escapeHtml(languageLabel(item.intakeLanguage))}</strong><small>${escapeHtml(item.intakeMode || "web intake")}</small></div>${item.contact?.phone ? `<a class="secondary button" href="tel:${escapeHtml(item.contact.phone)}">Call citizen</a>` : ""}</section>
    <section><h3>Review flags</h3><div class="flag-list">${flags.length ? flags.map((flag) => `<div class="flag ${flag.kind}">${escapeHtml(flag.text)}</div>`).join("") : '<p class="muted">No flags raised.</p>'}</div></section>
    <section><div class="section-head"><h3>${escapeHtml(primaryTranscript.title)}</h3><span class="engine">${escapeHtml(primaryTranscript.engine)}</span></div><div class="evidence-legend"><span class="dot identity"></span>Personal details <span class="dot financial"></span>Financial <span class="dot wellbeing"></span>Health / wellbeing <span class="dot family"></span>Family / care</div><div class="transcript">${transcriptHtml}</div><p class="audit">Exact word times remain available. Highlighted evidence replays from the beginning of its sentence.${item.transcript.fallbackReason ? ` Fallback reason: ${escapeHtml(item.transcript.fallbackReason)}` : ""}</p>
      ${primaryTranscript.isTranslated ? `<div class="translated-block"><div class="section-head"><h3>Original transcript</h3><span class="engine">ASR: ${escapeHtml(item.transcript.asrEngine || "failed")}${item.transcript.languageCode ? ` · ${escapeHtml(item.transcript.languageCode)}` : ""}</span></div><div class="transcript">${originalHtml}</div></div>` : item.translation?.status === "unavailable" ? '<div class="flag confidence">English translation unavailable — language-assisted review required.</div>' : ""}
      <div class="caller-rundown"><p class="eyebrow">Quick caller rundown</p><p>${escapeHtml(profile.summary)}</p><div class="characteristics">${profile.characteristics?.length ? profile.characteristics.map((fact) => `<button class="characteristic seek-audio evidence-${fact.category}" data-start="${Number(fact.sentenceStart ?? fact.start) || 0}"><span>${escapeHtml(fact.label)}${fact.requiresVerification ? " · verify" : ""}</span><strong>“${escapeHtml(fact.value)}”</strong><small>Phrase at ${Number(fact.start || 0).toFixed(1)}s · replay sentence</small></button>`).join("") : '<p class="muted">No key characteristics were automatically identified.</p>'}</div>${profile.missingCoreDetails?.length ? `<div class="missing-details"><strong>Ask next:</strong> ${escapeHtml(profile.missingCoreDetails.join(", "))}</div>` : ""}</div>
    </section>
    <section><div class="section-head"><h3>Scheme shortlist</h3><span class="engine">${escapeHtml(item.triage?.status || "pending")}</span></div><div class="shortlist">${shortlist.length ? shortlist.map((scheme) => `<article class="scheme-card"><div><strong>${escapeHtml(scheme.name)}</strong><span class="score">${escapeHtml(scheme.softScore)}</span></div><p>${escapeHtml(scheme.reasoning)}</p>${scheme.evidenceRefs?.length ? `<div class="scheme-evidence">${scheme.evidenceRefs.map((fact) => `<button class="characteristic seek-audio evidence-${escapeHtml(fact.category)}" data-start="${Number(fact.sentenceStart ?? fact.start) || 0}"><strong>“${escapeHtml(fact.quote)}”</strong><small>Phrase at ${Number(fact.start || 0).toFixed(1)}s · replay sentence</small></button>`).join("")}</div>` : ""}${scheme.insufficientInformation?.length ? `<div class="flag confidence">Missing: ${escapeHtml(scheme.insufficientInformation.join(", "))}</div>` : ""}${scheme.appealRelevant?.length ? `<div class="flag appeal">Appeal context: ${escapeHtml(scheme.appealRelevant.join("; "))}</div>` : ""}<label class="field-label">Officer reasoning<textarea class="review-textarea short scheme-reasoning" data-scheme-id="${escapeHtml(scheme.schemeId)}">${escapeHtml(scheme.officerReasoning || "")}</textarea></label><button class="secondary save-reasoning" data-scheme-id="${escapeHtml(scheme.schemeId)}">Save reasoning</button></article>`).join("") : '<div class="pending">No automated shortlist. Review the raw audio manually.</div>'}</div></section>
    <section id="review-section"><h3>Review before report generation</h3><p class="muted">Confirm the source material below. SilverArch will draft the formal report sections automatically, and you can edit the draft before finalizing.</p><div class="officer-profile"><label>Officer name<input id="officer-name" value="${escapeHtml(item.officerProfile?.name || "")}"></label><label>Designation<input id="officer-designation" value="${escapeHtml(item.officerProfile?.designation || "")}"></label><label>Social Service Office<input id="officer-sso" value="${escapeHtml(item.officerProfile?.sso || "")}"></label></div><label class="field-label" for="edit-transcript">Verified transcript</label><textarea id="edit-transcript" class="review-textarea">${escapeHtml(item.transcript.editedText ?? item.transcript.text ?? "")}</textarea><label class="field-label" for="edit-summary">Optional verified caller summary</label><textarea id="edit-summary" class="review-textarea">${escapeHtml(item.callerProfile?.officerSummary ?? item.callerProfile?.summary ?? "")}</textarea><details><summary>Optional fact review for better report drafting</summary><div class="fact-review-list">${factReviewHtml}</div></details><div class="review-confirmations"><label><input id="transcript-reviewed" type="checkbox" ${item.reviewAcknowledgements?.transcriptReviewed ? "checked" : ""}> I reviewed the available audio, transcript and evidence.</label>${item.urgency?.urgent || item.reviewReasons?.length ? `<label><input id="flags-reviewed" type="checkbox" ${item.reviewAcknowledgements?.flagsReviewed ? "checked" : ""}> I considered every review flag. The AI draft may propose formal wording, which I will review before finalization.</label>` : '<input id="flags-reviewed" type="checkbox" class="hidden">'}<label><input id="officer-declaration" type="checkbox" ${item.reviewAcknowledgements?.declaration ? "checked" : ""}> I confirm this report is supporting triage material and not an eligibility determination.</label></div><p id="review-save-status" class="muted">Changes save automatically.</p></section>
    <section><h3>PII redaction proposals</h3><div class="pii-controls">${piiControls || '<p class="muted">No PII proposals.</p>'}</div></section>
    <section><h3>Audit trail</h3><div class="audit-list">${(item.auditEvents || []).map((event) => `<p><strong>${escapeHtml(event.action)}</strong> · ${new Date(event.at).toLocaleString("en-SG")}<br><span>${escapeHtml(event.detail || "")}</span></p>`).join("") || '<p class="muted">No audit events recorded.</p>'}</div></section>
    <section id="report-readiness" class="report-readiness ${readiness.ready ? "ready" : "blocked"}"><h3>${readiness.ready ? "Ready to generate" : "Report not ready"}</h3>${readiness.ready ? '<p>All required review steps are complete. Generate an editable supporting report draft.</p>' : `<p>Complete the following items:</p><ul>${readiness.missing.map((entry) => `<li>${escapeHtml(entry.label)}</li>`).join("")}</ul>`}</section><div class="actions"><button class="secondary" data-action="needs-review">Keep in review</button><button class="secondary" data-action="escalated">Escalate</button>${reportAction}</div>`;
  document.querySelectorAll(".seek-audio").forEach((control) => control.addEventListener("click", () => { const audio = $("#case-audio"); if (audio) seekAndPlay(audio, Number(control.dataset.start)); }));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => updateStatus(item.id, button.dataset.action)));
  document.querySelectorAll("[data-pii-index]").forEach((button) => button.addEventListener("click", () => updateCase(item.id, { piiDecision: { index: Number(button.dataset.piiIndex), status: button.dataset.piiStatus } })));
  document.querySelectorAll(".save-reasoning").forEach((button) => button.addEventListener("click", () => updateCase(item.id, { reasoning: { schemeId: button.dataset.schemeId, text: document.querySelector(`.scheme-reasoning[data-scheme-id="${CSS.escape(button.dataset.schemeId)}"]`).value } })));
  document.querySelectorAll("[data-fact-status]").forEach((select) => select.addEventListener("change", () => document.querySelector(`[data-fact-explanation-wrap="${CSS.escape(select.dataset.factStatus)}"]`).classList.toggle("hidden", select.value !== "unknown")));
  setupAutoSave(item.id);
  $("#generate-report")?.addEventListener("click", () => generateReport(item.id));
  if ($("#case-audio")) setupAudioPlayer(duration);
}

function evidenceDisplayTranscript(item) {
  if (item.translation?.status === "ready") {
    const words = translationWords(item.translation.english);
    return { title: "English translation — highlighted evidence", engine: item.translation.provider || "translation", words, text: item.translation.english?.text || "", highlightEvidence: true, isTranslated: true };
  }
  return { title: "Original transcript", engine: `ASR: ${item.transcript.asrEngine || "failed"}${item.transcript.languageCode ? ` · ${item.transcript.languageCode}` : ""}`, words: item.transcript.words || item.transcript.segments || [], text: item.transcript.text || "", highlightEvidence: true, isTranslated: false };
}

function translationWords(translation = {}) {
  if (translation.words?.length) return translation.words;
  return (translation.sentences || []).flatMap((sentence) => {
    const tokens = String(sentence.text || "").split(/\s+/).filter(Boolean);
    const start = Number(sentence.sourceStart ?? sentence.start) || 0;
    const end = Number(sentence.sourceEnd ?? sentence.end) || start;
    const step = tokens.length ? Math.max(0, end - start) / tokens.length : 0;
    return tokens.map((text, index) => ({ text, start: start + step * index, end: start + step * (index + 1) }));
  });
}

async function saveOfficerReview(id, { silent = false } = {}) {
  const factReviews = Object.fromEntries([...document.querySelectorAll("[data-fact-review]")].map((row) => { const key = row.dataset.factReview; return [key, { status: row.querySelector(`[data-fact-status="${CSS.escape(key)}"]`).value, value: row.querySelector(`[data-fact-value="${CSS.escape(key)}"]`).value, explanation: row.querySelector(`[data-fact-explanation="${CSS.escape(key)}"]`).value }]; }));
  return updateCase(id, { transcriptText: $("#edit-transcript").value, summary: $("#edit-summary").value, officerProfile: { name: $("#officer-name").value, designation: $("#officer-designation").value, sso: $("#officer-sso").value }, factReviews, reviewAcknowledgements: { transcriptReviewed: $("#transcript-reviewed").checked, flagsReviewed: $("#flags-reviewed").checked, declaration: $("#officer-declaration").checked } }, { rerender: !silent, silent });
}

async function generateReport(id) {
  await flushAutoSave(id);
  const response = await fetch(`/api/cases/${id}/report`, { method: "POST" });
  if (response.ok) location.href = `/report.html?case=${encodeURIComponent(id)}`;
  else { const body = await response.json(); alert(body.error || "The report could not be generated."); }
}

function seekAndPlay(audio, seconds) {
  const seek = () => { audio.currentTime = seconds; audio.play(); };
  if (audio.readyState >= 1) seek(); else audio.addEventListener("loadedmetadata", seek, { once: true });
}

function setupAudioPlayer(duration) {
  const audio = $("#case-audio"); const slider = $("#audio-slider"); const current = $("#audio-current"); const toggle = $("#audio-toggle");
  toggle.addEventListener("click", () => audio.paused ? audio.play() : audio.pause());
  audio.addEventListener("play", () => { toggle.textContent = "❚❚"; toggle.setAttribute("aria-label", "Pause recording"); });
  audio.addEventListener("pause", () => { toggle.textContent = "▶"; toggle.setAttribute("aria-label", "Play recording"); });
  audio.addEventListener("timeupdate", () => { slider.value = String(audio.currentTime); current.textContent = formatTime(audio.currentTime); });
  slider.addEventListener("input", () => { current.textContent = formatTime(Number(slider.value)); if (audio.readyState >= 1) audio.currentTime = Number(slider.value); });
  audio.addEventListener("loadedmetadata", () => { if (!duration && Number.isFinite(audio.duration)) slider.max = String(audio.duration); });
}

async function updateStatus(id, status) {
  return updateCase(id, { status, note: $("#officer-note")?.value || "" });
}

function setupAutoSave(id) {
  const section = $("#review-section");
  if (!section) return;
  section.querySelectorAll("input, textarea, select").forEach((control) => {
    const eventName = control.matches("input[type='checkbox'], select") ? "change" : "input";
    control.addEventListener(eventName, () => scheduleAutoSave(id));
  });
}

function scheduleAutoSave(id) {
  $("#review-save-status").textContent = "Saving…";
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveOfficerReview(id, { silent: true }), 650);
}

async function flushAutoSave(id) {
  clearTimeout(autoSaveTimer);
  if ($("#review-section")) await saveOfficerReview(id, { silent: true });
}

async function updateCase(id, patch, { rerender = true, silent = false } = {}) {
  const response = await fetch(`/api/cases/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!response.ok) {
    if (silent && $("#review-save-status")) $("#review-save-status").textContent = "Could not save";
    return null;
  }
  const updated = await response.json(); cases = cases.map((item) => item.id === id ? updated : item); renderList();
  if (rerender) renderDetail(id);
  else {
    updateReportReadiness(updated.reportReadiness);
    if ($("#review-save-status")) $("#review-save-status").textContent = "Saved";
  }
  return updated;
}

function updateReportReadiness(readiness = { ready: false, missing: [] }) {
  const panel = $("#report-readiness"); const button = $("#generate-report");
  if (!panel) return;
  panel.className = `report-readiness ${readiness.ready ? "ready" : "blocked"}`;
  panel.innerHTML = `<h3>${readiness.ready ? "Ready to generate" : "Report not ready"}</h3>${readiness.ready ? '<p>All required review steps are complete. Generate an editable supporting report draft.</p>' : `<p>Complete the following items:</p><ul>${readiness.missing.map((entry) => `<li>${escapeHtml(entry.label)}</li>`).join("")}</ul>`}`;
  if (button) button.disabled = !readiness.ready;
}

async function load() {
  cases = await fetch("/api/cases").then((response) => response.json());
  cases.sort((a, b) => Number(b.urgency?.urgent) - Number(a.urgency?.urgent) || new Date(a.createdAt) - new Date(b.createdAt));
  renderList();
}

$("#refresh").addEventListener("click", load);
$("#filter-status").addEventListener("change", renderList);
$("#filter-reason").addEventListener("change", renderList);
$("#load-fixtures").addEventListener("click", () => changeFixtures("load"));
$("#reset-fixtures").addEventListener("click", () => changeFixtures("reset"));

async function changeFixtures(action) {
  const response = await fetch("/api/demo/fixtures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
  if (response.ok) await load();
}
load();
