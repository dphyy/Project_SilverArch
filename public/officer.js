const $ = (selector) => document.querySelector(selector);
let cases = [];

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const formatTime = (seconds = 0) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
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
  const words = item.transcript.words || item.transcript.segments || [];
  const evidence = item.evidence || [];
  const evidenceForWord = (index) => item.evidenceLanguage !== "english" && evidence.find((fact) => index >= fact.startWord && index <= fact.endWord);
  const transcriptHtml = words.length ? words.map((word, index) => {
    const marker = evidenceForWord(index);
    const classes = marker ? `word seek-audio evidence-word evidence-${marker.category}` : "word seek-audio";
    const title = marker ? `${marker.label} · exact phrase ${Number(word.start || 0).toFixed(1)}s` : `Play from ${Number(word.start || 0).toFixed(1)}s`;
    return `<button class="${classes}" data-start="${marker ? Number(marker.sentenceStart) || 0 : Number(word.start) || 0}" title="${escapeHtml(title)}">${escapeHtml(word.text)}</button>`;
  }).join(" ") : escapeHtml(item.transcript.text || "No transcript available. Review the raw audio.");
  const shortlist = item.triage?.shortlist || [];
  const profile = item.callerProfile || { summary: "This case predates automatic evidence extraction.", characteristics: [], missingCoreDetails: [] };
  const duration = Math.max(Number(item.audioDurationMs || 0) / 1000, ...words.map((word) => Number(word.end) || 0), 0);
  const translatedSentences = item.translation?.status === "ready" ? item.translation.english?.sentences || [] : [];
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
    <section class="contact-card"><div><span>SSO callback number</span><strong>${escapeHtml(item.contact?.phone || "Not collected")}</strong></div>${item.contact?.phone ? `<a class="secondary button" href="tel:${escapeHtml(item.contact.phone)}">Call citizen</a>` : ""}</section>
    <section><h3>Review flags</h3><div class="flag-list">${flags.length ? flags.map((flag) => `<div class="flag ${flag.kind}">${escapeHtml(flag.text)}</div>`).join("") : '<p class="muted">No flags raised.</p>'}</div></section>
    <section><div class="section-head"><h3>Original transcript</h3><span class="engine">ASR: ${escapeHtml(item.transcript.asrEngine || "failed")}${item.transcript.languageCode ? ` · ${escapeHtml(item.transcript.languageCode)}` : ""}</span></div><div class="evidence-legend"><span class="dot identity"></span>Personal details <span class="dot financial"></span>Financial <span class="dot wellbeing"></span>Health / wellbeing <span class="dot family"></span>Family / care</div><div class="transcript">${transcriptHtml}</div><p class="audit">Exact word times remain available. Highlighted evidence replays from the beginning of its sentence.${item.transcript.fallbackReason ? ` Fallback reason: ${escapeHtml(item.transcript.fallbackReason)}` : ""}</p>
      ${translatedSentences.length ? `<div class="translated-block"><div class="section-head"><h3>English translation</h3><span class="engine">${escapeHtml(item.translation.provider)}</span></div><div class="transcript">${translatedSentences.map((sentence) => `<button class="translated-sentence seek-audio" data-start="${Number(sentence.sourceStart ?? sentence.start) || 0}">${escapeHtml(sentence.text)} <small>${formatTime(Number(sentence.sourceStart ?? sentence.start) || 0)}</small></button>`).join(" ")}</div></div>` : item.translation?.status === "unavailable" ? '<div class="flag confidence">English translation unavailable — language-assisted review required.</div>' : ""}
      <div class="caller-rundown"><p class="eyebrow">Quick caller rundown</p><p>${escapeHtml(profile.summary)}</p><div class="characteristics">${profile.characteristics?.length ? profile.characteristics.map((fact) => `<button class="characteristic seek-audio evidence-${fact.category}" data-start="${Number(fact.sentenceStart ?? fact.start) || 0}"><span>${escapeHtml(fact.label)}${fact.requiresVerification ? " · verify" : ""}</span><strong>“${escapeHtml(fact.value)}”</strong><small>Phrase at ${Number(fact.start || 0).toFixed(1)}s · replay sentence</small></button>`).join("") : '<p class="muted">No key characteristics were automatically identified.</p>'}</div>${profile.missingCoreDetails?.length ? `<div class="missing-details"><strong>Ask next:</strong> ${escapeHtml(profile.missingCoreDetails.join(", "))}</div>` : ""}</div>
    </section>
    <section><div class="section-head"><h3>Scheme shortlist</h3><span class="engine">${escapeHtml(item.triage?.status || "pending")}</span></div><div class="shortlist">${shortlist.length ? shortlist.map((scheme) => `<article class="scheme-card"><div><strong>${escapeHtml(scheme.name)}</strong><span class="score">${escapeHtml(scheme.softScore)}</span></div><p>${escapeHtml(scheme.reasoning)}</p>${scheme.evidenceRefs?.length ? `<div class="scheme-evidence">${scheme.evidenceRefs.map((fact) => `<button class="characteristic seek-audio evidence-${escapeHtml(fact.category)}" data-start="${Number(fact.sentenceStart ?? fact.start) || 0}"><strong>“${escapeHtml(fact.quote)}”</strong><small>Phrase at ${Number(fact.start || 0).toFixed(1)}s · replay sentence</small></button>`).join("")}</div>` : ""}${scheme.insufficientInformation?.length ? `<div class="flag confidence">Missing: ${escapeHtml(scheme.insufficientInformation.join(", "))}</div>` : ""}${scheme.appealRelevant?.length ? `<div class="flag appeal">Appeal context: ${escapeHtml(scheme.appealRelevant.join("; "))}</div>` : ""}<label class="field-label">Officer reasoning<textarea class="review-textarea short scheme-reasoning" data-scheme-id="${escapeHtml(scheme.schemeId)}">${escapeHtml(scheme.officerReasoning || "")}</textarea></label><button class="secondary save-reasoning" data-scheme-id="${escapeHtml(scheme.schemeId)}">Save reasoning</button></article>`).join("") : '<div class="pending">No automated shortlist. Review the raw audio manually.</div>'}</div></section>
    <section><h3>Officer review and report readiness</h3><div class="officer-profile"><label>Officer name<input id="officer-name" value="${escapeHtml(item.officerProfile?.name || "")}"></label><label>Designation<input id="officer-designation" value="${escapeHtml(item.officerProfile?.designation || "")}"></label><label>Social Service Office<input id="officer-sso" value="${escapeHtml(item.officerProfile?.sso || "")}"></label></div><label class="field-label" for="edit-transcript">Verified transcript</label><textarea id="edit-transcript" class="review-textarea">${escapeHtml(item.transcript.editedText ?? item.transcript.text ?? "")}</textarea><label class="field-label" for="edit-summary">Verified caller summary</label><textarea id="edit-summary" class="review-textarea">${escapeHtml(item.callerProfile?.officerSummary ?? item.callerProfile?.summary ?? "")}</textarea><h4>Verified facts</h4><div class="fact-review-list">${factReviewHtml}</div><div class="consolidation-editor"><h4>Officer consolidation</h4><p class="muted">Complete all three sections in formal, factual language. These statements will appear in the supporting report.</p><label class="field-label" for="presenting-circumstances">Presenting circumstances</label><textarea id="presenting-circumstances" class="review-textarea">${escapeHtml(item.consolidation?.presentingCircumstances || "")}</textarea><label class="field-label" for="officer-assessment">Officer assessment</label><textarea id="officer-assessment" class="review-textarea">${escapeHtml(item.consolidation?.assessment || "")}</textarea><label class="field-label" for="recommended-follow-up">Recommended follow-up</label><textarea id="recommended-follow-up" class="review-textarea">${escapeHtml(item.consolidation?.recommendedFollowUp || "")}</textarea>${item.urgency?.urgent || item.reviewReasons?.length ? `<label class="field-label" for="safeguards-resolution">Safeguards and review-flag resolution</label><textarea id="safeguards-resolution" class="review-textarea">${escapeHtml(item.consolidation?.safeguardsResolution || "")}</textarea>` : '<textarea id="safeguards-resolution" class="hidden"></textarea>'}</div><div class="review-confirmations"><label><input id="transcript-reviewed" type="checkbox" ${item.reviewAcknowledgements?.transcriptReviewed ? "checked" : ""}> I reviewed the available audio, transcript and evidence.</label>${item.urgency?.urgent || item.reviewReasons?.length ? `<label><input id="flags-reviewed" type="checkbox" ${item.reviewAcknowledgements?.flagsReviewed ? "checked" : ""}> I considered every review flag and documented the resolution.</label>` : '<input id="flags-reviewed" type="checkbox" class="hidden">'}<label><input id="officer-declaration" type="checkbox" ${item.reviewAcknowledgements?.declaration ? "checked" : ""}> I confirm this report is supporting triage material and not an eligibility determination.</label></div><button id="save-review" class="secondary">Save officer review</button></section>
    <section><h3>PII redaction proposals</h3><div class="pii-controls">${piiControls || '<p class="muted">No PII proposals.</p>'}</div></section>
    <section><h3>Audit trail</h3><div class="audit-list">${(item.auditEvents || []).map((event) => `<p><strong>${escapeHtml(event.action)}</strong> · ${new Date(event.at).toLocaleString("en-SG")}<br><span>${escapeHtml(event.detail || "")}</span></p>`).join("") || '<p class="muted">No audit events recorded.</p>'}</div></section>
    <section class="report-readiness ${readiness.ready ? "ready" : "blocked"}"><h3>${readiness.ready ? "Ready to generate" : "Report not ready"}</h3>${readiness.ready ? '<p>All required review steps are complete. Generate an editable supporting report draft.</p>' : `<p>Complete and save the following items:</p><ul>${readiness.missing.map((entry) => `<li>${escapeHtml(entry.label)}</li>`).join("")}</ul>`}</section><div class="actions"><button class="secondary" data-action="needs-review">Keep in review</button><button class="secondary" data-action="escalated">Escalate</button>${reportAction}</div>`;
  document.querySelectorAll(".seek-audio").forEach((control) => control.addEventListener("click", () => { const audio = $("#case-audio"); if (audio) seekAndPlay(audio, Number(control.dataset.start)); }));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => updateStatus(item.id, button.dataset.action)));
  document.querySelectorAll("[data-pii-index]").forEach((button) => button.addEventListener("click", () => updateCase(item.id, { piiDecision: { index: Number(button.dataset.piiIndex), status: button.dataset.piiStatus } })));
  document.querySelectorAll(".save-reasoning").forEach((button) => button.addEventListener("click", () => updateCase(item.id, { reasoning: { schemeId: button.dataset.schemeId, text: document.querySelector(`.scheme-reasoning[data-scheme-id="${CSS.escape(button.dataset.schemeId)}"]`).value } })));
  document.querySelectorAll("[data-fact-status]").forEach((select) => select.addEventListener("change", () => document.querySelector(`[data-fact-explanation-wrap="${CSS.escape(select.dataset.factStatus)}"]`).classList.toggle("hidden", select.value !== "unknown")));
  $("#save-review").addEventListener("click", () => saveOfficerReview(item.id));
  $("#generate-report")?.addEventListener("click", () => generateReport(item.id));
  if ($("#case-audio")) setupAudioPlayer(duration);
}

async function saveOfficerReview(id) {
  const factReviews = Object.fromEntries([...document.querySelectorAll("[data-fact-review]")].map((row) => { const key = row.dataset.factReview; return [key, { status: row.querySelector(`[data-fact-status="${CSS.escape(key)}"]`).value, value: row.querySelector(`[data-fact-value="${CSS.escape(key)}"]`).value, explanation: row.querySelector(`[data-fact-explanation="${CSS.escape(key)}"]`).value }]; }));
  return updateCase(id, { transcriptText: $("#edit-transcript").value, summary: $("#edit-summary").value, officerProfile: { name: $("#officer-name").value, designation: $("#officer-designation").value, sso: $("#officer-sso").value }, factReviews, consolidation: { presentingCircumstances: $("#presenting-circumstances").value, assessment: $("#officer-assessment").value, recommendedFollowUp: $("#recommended-follow-up").value, safeguardsResolution: $("#safeguards-resolution").value }, reviewAcknowledgements: { transcriptReviewed: $("#transcript-reviewed").checked, flagsReviewed: $("#flags-reviewed").checked, declaration: $("#officer-declaration").checked } });
}

async function generateReport(id) {
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

async function updateCase(id, patch) {
  const response = await fetch(`/api/cases/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!response.ok) return;
  const updated = await response.json(); cases = cases.map((item) => item.id === id ? updated : item); renderList(); renderDetail(id);
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
