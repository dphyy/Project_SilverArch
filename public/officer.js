const $ = (selector) => document.querySelector(selector);
let cases = [];
let selectedCaseId = null;

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
    <button class="case-card ${item.urgency?.urgent ? "urgent" : ""} ${item.id === selectedCaseId ? "selected" : ""}" data-id="${item.id}" aria-pressed="${item.id === selectedCaseId ? "true" : "false"}">
      <span><strong>${item.urgency?.urgent ? "Urgent risk" : "Voice intake"}</strong><small>${new Date(item.createdAt).toLocaleString("en-SG")}</small></span>
      <span><em>${waiting(item.createdAt)}</em><small>${item.transcript.asrEngine || "ASR failed"}${item.translation?.status === "ready" ? ` · ${item.translation.provider}` : item.translation?.status === "unavailable" ? " · translation unavailable" : ""}</small></span>
    </button>`).join("") : '<div class="empty-card"><strong>No matching cases</strong><p>Adjust the filters or submit a demo recording.</p></div>';
  document.querySelectorAll(".case-card").forEach((button) => button.addEventListener("click", () => renderDetail(button.dataset.id)));
}

function renderDetail(id) {
  const item = cases.find((entry) => entry.id === id);
  if (!item) {
    selectedCaseId = null;
    renderList();
    $("#case-detail").className = "detail empty";
    $("#case-detail").innerHTML = "<p>Select a case to review the citizen testimony.</p>";
    return;
  }
  if (selectedCaseId !== id) {
    selectedCaseId = id;
    renderList();
  }
  const flags = [
    ...(item.urgency?.urgent ? [{ kind: "urgent", text: `${item.urgency.reason}: ${item.urgency.resource}` }] : []),
    ...(item.reviewReasons || []).map((text) => ({ kind: "confidence", text })),
    ...(item.piiProposals || []).filter((proposal) => proposal.status === "proposed").map((proposal) => ({ kind: "pii", text: `${proposal.type} needs officer confirmation` }))
  ];
  const evidence = displayEvidence(item);
  const primaryTranscript = evidenceDisplayTranscript(item);
  const words = primaryTranscript.words;
  const evidenceMarkers = buildEvidenceWordMarkers(evidence, words, primaryTranscript.highlightEvidence);
  const evidenceForWord = (index) => evidenceMarkers.get(index);
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
  const readiness = item.reportReadiness || { ready: false, missing: [{ label: "Save the officer review to check report readiness" }] };
  const reportAction = item.reportSummary ? `<a class="primary button" href="/report.html?case=${encodeURIComponent(item.id)}">${item.reportSummary.status === "finalized" ? "View finalized report" : "Continue report draft"}</a>` : `<button id="generate-report" class="primary" ${readiness.ready ? "" : "disabled"}>Generate report</button>`;
  const callback = callbackPlan(item, evidence, profile, shortlist, flags);
  const council = reviewCouncil(item, shortlist, profile, flags);
  $("#case-detail").className = "detail";
  $("#case-detail").innerHTML = `
    <div class="detail-head"><div><p class="eyebrow">Case ${item.id.slice(0, 8)}</p><h2>Citizen testimony</h2></div><span class="badge">${escapeHtml(item.status)}</span></div>
    ${item.audioUrl ? `<audio id="case-audio" preload="metadata" src="${item.audioUrl}"></audio><div class="audio-player"><button id="audio-toggle" class="audio-toggle" aria-label="Play recording">▶</button><span id="audio-current">00:00</span><input id="audio-slider" type="range" min="0" max="${duration}" step="0.01" value="0" aria-label="Recording position"><span>${formatTime(duration)}</span></div>` : '<div class="pending">No audio recording is attached to this case.</div>'}
    <section class="contact-card"><div><span>SSO callback number</span><strong>${escapeHtml(item.contact?.phone || "Not collected")}</strong></div><div><span>Intake language</span><strong>${escapeHtml(languageLabel(item.intakeLanguage))}</strong><small>${escapeHtml(item.intakeMode || "web intake")}</small></div>${item.contact?.phone ? `<a class="secondary button" href="tel:${escapeHtml(item.contact.phone)}">Call citizen</a>` : ""}</section>
    <section><h3>Review flags</h3><div class="flag-list">${flags.length ? flags.map((flag) => `<div class="flag ${flag.kind}">${escapeHtml(flag.text)}</div>`).join("") : '<p class="muted">No flags raised.</p>'}</div></section>
    <section class="review-council"><div class="section-head"><h3>Review council</h3><span class="engine">${council.confidenceScore}% confidence</span></div>${council.humanEscalationRequired ? `<div class="escalation-banner">Human escalation required: ${escapeHtml(council.triggers.join(" · "))}</div>` : '<p class="muted">No council escalation trigger detected. Officer judgement still applies.</p>'}<div class="council-grid">${council.perspectives.map((perspective) => `<article class="council-card ${escapeHtml(perspective.status)}"><span>${escapeHtml(perspective.title)}</span><p>${escapeHtml(perspective.summary)}</p></article>`).join("")}</div></section>
    <section><div class="section-head"><h3>${escapeHtml(primaryTranscript.title)}</h3><span class="engine">${escapeHtml(primaryTranscript.engine)}</span></div><div class="evidence-legend"><span class="dot identity"></span>Personal details <span class="dot financial"></span>Financial <span class="dot wellbeing"></span>Health / wellbeing <span class="dot family"></span>Family / care <span class="evidence-source">${escapeHtml(evidenceSourceLabel(item.evidenceProvider))}</span></div><div class="transcript">${transcriptHtml}</div><p class="audit">Exact word times remain available. Highlighted evidence replays from the beginning of its sentence. Evidence: ${escapeHtml(evidenceSourceLabel(item.evidenceProvider))}.${item.evidenceProviderError ? ` Note: ${escapeHtml(item.evidenceProviderError)}` : ""}${item.transcript.fallbackReason ? ` Fallback reason: ${escapeHtml(item.transcript.fallbackReason)}` : ""}</p>
      ${primaryTranscript.isTranslated ? `<div class="translated-block"><div class="section-head"><h3>Original transcript</h3><span class="engine">ASR: ${escapeHtml(item.transcript.asrEngine || "failed")}${item.transcript.languageCode ? ` · ${escapeHtml(item.transcript.languageCode)}` : ""}</span></div><div class="transcript">${originalHtml}</div></div>` : item.translation?.status === "unavailable" ? '<div class="flag confidence">English translation unavailable — language-assisted review required.</div>' : ""}
      <div class="caller-rundown"><p class="eyebrow">Quick caller rundown</p><p>${escapeHtml(profile.summary)}</p><div class="characteristics">${profile.characteristics?.length ? profile.characteristics.map((fact) => `<button class="characteristic seek-audio evidence-${fact.category}" data-start="${Number(fact.sentenceStart ?? fact.start) || 0}"><span>${escapeHtml(fact.label)}${fact.requiresVerification ? " · verify" : ""}</span><strong>“${escapeHtml(fact.value)}”</strong><small>Phrase at ${Number(fact.start || 0).toFixed(1)}s · replay sentence</small></button>`).join("") : '<p class="muted">No key characteristics were automatically identified.</p>'}</div>${profile.missingCoreDetails?.length ? `<div class="missing-details"><strong>Ask next:</strong> ${escapeHtml(profile.missingCoreDetails.join(", "))}</div>` : ""}</div>
    </section>
    <section><div class="section-head"><h3>Scheme shortlist</h3><span class="engine">${escapeHtml(item.triage?.status || "pending")}</span></div><div class="shortlist">${shortlist.length ? shortlist.map((scheme) => `<article class="scheme-card"><div><strong>${escapeHtml(scheme.name)}</strong><span class="score">${escapeHtml(scheme.softScore)}</span></div><p>${escapeHtml(scheme.reasoning)}</p>${scheme.evidenceRefs?.length ? `<div class="scheme-evidence">${scheme.evidenceRefs.map((fact) => `<button class="characteristic seek-audio evidence-${escapeHtml(fact.category)}" data-start="${Number(fact.sentenceStart ?? fact.start) || 0}"><strong>“${escapeHtml(fact.quote)}”</strong><small>Phrase at ${Number(fact.start || 0).toFixed(1)}s · replay sentence</small></button>`).join("")}</div>` : ""}${scheme.insufficientInformation?.length ? `<div class="flag confidence">Missing: ${escapeHtml(scheme.insufficientInformation.join(", "))}</div>` : ""}${scheme.appealRelevant?.length ? `<div class="flag appeal">Appeal context: ${escapeHtml(scheme.appealRelevant.join("; "))}</div>` : ""}<label class="field-label">Officer reasoning<textarea class="review-textarea short scheme-reasoning" data-scheme-id="${escapeHtml(scheme.schemeId)}">${escapeHtml(scheme.officerReasoning || "")}</textarea></label><button class="secondary save-reasoning" data-scheme-id="${escapeHtml(scheme.schemeId)}">Save reasoning</button></article>`).join("") : '<div class="pending">No automated shortlist. Review the raw audio manually.</div>'}</div></section>
    <section class="callback-script"><div class="section-head"><h3>SSO callback script</h3><span class="engine">${escapeHtml(callback.contact)}</span></div><div class="callback-grid"><article><h4>Call checklist</h4>${callback.checklist.length ? callback.checklist.map((item) => `<label><input type="checkbox"> ${escapeHtml(item)}</label>`).join("") : '<p class="muted">No specific clarification checklist was generated.</p>'}</article><article><h4>Suggested script</h4>${callback.script.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</article></div><h4>Clarification questions</h4><ol>${callback.questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ol></section>
    <section id="review-section"><h3>Review before report generation</h3><p class="muted">Confirm the source material below. SilverArch will draft the formal report sections automatically, and you can edit the draft before finalizing.</p><div class="officer-profile"><label>Officer name<input id="officer-name" value="${escapeHtml(item.officerProfile?.name || "")}"></label><label>Designation<input id="officer-designation" value="${escapeHtml(item.officerProfile?.designation || "")}"></label><label>Social Service Office<input id="officer-sso" value="${escapeHtml(item.officerProfile?.sso || "")}"></label></div><label class="field-label" for="edit-transcript">Verified transcript</label><textarea id="edit-transcript" class="review-textarea">${escapeHtml(item.transcript.editedText ?? item.transcript.text ?? "")}</textarea><label class="field-label" for="edit-summary">Optional verified caller summary</label><textarea id="edit-summary" class="review-textarea">${escapeHtml(item.callerProfile?.officerSummary ?? item.callerProfile?.summary ?? "")}</textarea><div class="review-confirmations"><label><input id="transcript-reviewed" type="checkbox" ${item.reviewAcknowledgements?.transcriptReviewed ? "checked" : ""}> I reviewed the available audio, transcript and evidence.</label>${item.urgency?.urgent || item.reviewReasons?.length ? `<label><input id="flags-reviewed" type="checkbox" ${item.reviewAcknowledgements?.flagsReviewed ? "checked" : ""}> I considered every review flag. The AI draft may propose formal wording, which I will review before finalization.</label>` : '<input id="flags-reviewed" type="checkbox" class="hidden">'}<label><input id="officer-declaration" type="checkbox" ${item.reviewAcknowledgements?.declaration ? "checked" : ""}> I confirm this report is supporting triage material and not an eligibility determination.</label></div><p id="review-save-status" class="muted">Changes save automatically.</p></section>
    <section><h3>PII redaction proposals</h3><div class="pii-controls">${piiControls || '<p class="muted">No PII proposals.</p>'}</div></section>
    <section><h3>Audit trail</h3><div class="audit-list">${(item.auditEvents || []).map((event) => `<p><strong>${escapeHtml(event.action)}</strong> · ${new Date(event.at).toLocaleString("en-SG")}<br><span>${escapeHtml(event.detail || "")}</span></p>`).join("") || '<p class="muted">No audit events recorded.</p>'}</div></section>
    <section id="report-readiness" class="report-readiness ${readiness.ready ? "ready" : "blocked"}"><h3>${readiness.ready ? "Ready to generate" : "Report not ready"}</h3>${readiness.ready ? '<p>All required review steps are complete. Generate an editable supporting report draft.</p>' : `<p>Complete the following items:</p><ul>${readiness.missing.map((entry) => `<li>${escapeHtml(entry.label)}</li>`).join("")}</ul>`}</section><div class="actions">${item.audioUrl ? '<button id="reanalyse-audio" class="secondary">Reanalyse audio</button>' : ""}<button class="secondary" data-action="needs-review">Keep in review</button><button class="secondary" data-action="escalated">Escalate</button>${reportAction}</div>`;
  document.querySelectorAll(".seek-audio").forEach((control) => control.addEventListener("click", () => { const audio = $("#case-audio"); if (audio) seekAndPlay(audio, Number(control.dataset.start)); }));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => updateStatus(item.id, button.dataset.action)));
  document.querySelectorAll("[data-pii-index]").forEach((button) => button.addEventListener("click", () => updateCase(item.id, { piiDecision: { index: Number(button.dataset.piiIndex), status: button.dataset.piiStatus } })));
  document.querySelectorAll(".save-reasoning").forEach((button) => button.addEventListener("click", () => updateCase(item.id, { reasoning: { schemeId: button.dataset.schemeId, text: document.querySelector(`.scheme-reasoning[data-scheme-id="${CSS.escape(button.dataset.schemeId)}"]`).value } })));
  setupAutoSave(item.id);
  $("#reanalyse-audio")?.addEventListener("click", () => reanalyseAudio(item.id));
  $("#generate-report")?.addEventListener("click", () => generateReport(item.id));
  if ($("#case-audio")) setupAudioPlayer(duration);
}

function evidenceDisplayTranscript(item) {
  if (item.translation?.status === "ready") {
    const words = translationWords(item.translation.english);
    return { title: "English translation — highlighted evidence", engine: item.translation.provider || "translation", words, text: item.translation.english?.text || "", highlightEvidence: true, isTranslated: true };
  }
  return { title: "Original transcript", engine: `ASR: ${item.transcript.asrEngine || "failed"} · ${item.transcript.languageCode || "language unknown"}`, words: item.transcript.words || item.transcript.segments || [], text: item.transcript.text || "", highlightEvidence: true, isTranslated: false };
}

function evidenceSourceLabel(provider = "") {
  if (provider === "openai") return "AI highlights";
  if (provider === "openai+deterministic-safety") return "AI highlights + safety rules";
  if (provider === "deterministic") return "Rule-based highlights";
  return provider ? `${provider} highlights` : "Evidence highlights";
}

function callbackPlan(item, evidence = [], profile = {}, shortlist = [], flags = []) {
  const contact = item.contact?.phone || "No callback number";
  const aicShortlist = shortlist.filter((scheme) => String(scheme.schemeId || "").startsWith("aic_"));
  const hasAicSignals = aicShortlist.length || evidence.some((item) => /caregiv|disab|wheelchair|mobility|assistive|adl|bathe|shower|dress|toilet|feed|frail|elderly|senior/i.test(`${item.text} ${item.label}`));
  const checklist = uniqueItems([
    item.contact?.phone ? `Call ${item.contact.phone} and confirm it is a safe number to use.` : "Obtain a reachable phone number before follow-up.",
    "Confirm the caller's name and preferred language for the callback.",
    ...(flags.length ? ["Review flags before asking routine questions."] : []),
    ...(item.urgency?.urgent ? [`If risk is still immediate, redirect to ${item.urgency.resource || "emergency support"} before continuing triage.`] : []),
    ...(item.piiProposals || []).filter((proposal) => proposal.status === "proposed").map((proposal) => `Verify whether the ${proposal.type} was intentionally provided, then confirm or reject the redaction proposal.`),
    ...(profile.missingCoreDetails || []).map((detail) => `Clarify ${plainDetail(detail)}.`),
    ...(hasAicSignals ? ["Check whether AIC Link or another AIC referral pathway should be considered after SSO review."] : []),
    ...shortlist.flatMap((scheme) => (scheme.insufficientInformation || []).map((detail) => `Clarify for ${scheme.name}: ${detail}.`)),
    ...evidence.filter((item) => item.requiresVerification).map((item) => `Verify the statement: "${item.text}".`)
  ]);
  const questions = uniqueItems([
    "Can I confirm your full name and whether this is a safe time and number to speak?",
    `Would you prefer to continue in ${languageLabel(item.intakeLanguage)} or another language?`,
    ...(profile.missingCoreDetails || []).map((detail) => questionForDetail(detail)),
    ...(hasAicSignals ? [
      "Does the person needing care require help with activities of daily living, such as bathing, dressing, toileting, feeding or transferring?",
      "Are any mobility or assistive devices needed, such as a wheelchair, walking aid, commode or hospital bed?",
      "Who is the main caregiver, and would caregiver training or respite support be useful?",
      "Has any doctor, therapist or assessor documented the disability, mobility or long-term care need?",
      "Would you be comfortable if the officer explores whether an AIC Link referral is suitable?"
    ] : []),
    ...shortlist.flatMap((scheme) => (scheme.insufficientInformation || []).map((detail) => `For ${scheme.name}, can you clarify ${detail.replace(/\s+not stated$/i, "")}?`)),
    ...evidence.filter((item) => item.requiresVerification).map((item) => `You mentioned "${item.text}". Can I confirm that detail is accurate?`),
    ...(item.urgency?.urgent ? ["Are you safe right now, and do you need emergency assistance before we continue?"] : []),
    "What has changed recently, and what help do you need most urgently now?",
    "Are there documents or contact details you can provide to support the review?"
  ]);
  const script = [
    `Hello, I am calling from the Social Service Office regarding the ComCare voice message submitted through SilverArch.`,
    `I need to verify a few details so the officer review and any supporting report are accurate. This call does not determine eligibility.`,
    `I will ask only for information needed to clarify your situation, and you may tell me if any question is uncomfortable or unsafe to answer.`,
    `At the end, I will summarize what I understood and explain that an officer will review the information.`
  ];
  return { contact, checklist, questions, script };
}

function reviewCouncil(item, shortlist = [], profile = {}, flags = []) {
  const unresolvedPii = (item.piiProposals || []).filter((proposal) => proposal.status === "proposed").length;
  const missingCore = profile.missingCoreDetails || [];
  const schemeMissing = shortlist.flatMap((scheme) => scheme.insufficientInformation || []);
  const reviewReasons = [...(item.reviewReasons || []), ...(item.transcript?.confidenceFlags || [])].filter(Boolean);
  const aicReferrals = shortlist.filter((scheme) => String(scheme.schemeId || "").startsWith("aic_"));
  const translationUncertainty = ["pending", "unavailable", "failed"].includes(item.translation?.status);
  const majorMissing = [...new Set([...missingCore, ...schemeMissing])];
  const triggers = [
    ...(item.urgency?.urgent ? ["urgent or safeguarding risk"] : []),
    ...(flags.length || reviewReasons.length ? ["review or confidence flags"] : []),
    ...(unresolvedPii ? ["unresolved PII"] : []),
    ...(translationUncertainty ? ["translation uncertainty"] : []),
    ...(majorMissing.length >= 2 ? ["major missing facts"] : [])
  ];
  const confidenceScore = Math.max(0, 100 - [
    item.urgency?.urgent ? 25 : 0,
    flags.length || reviewReasons.length ? 15 : 0,
    unresolvedPii ? 20 : 0,
    translationUncertainty ? 10 : 0,
    Math.min(20, majorMissing.length * 5),
    shortlist.length ? 0 : 10
  ].reduce((sum, value) => sum + value, 0));
  return {
    humanEscalationRequired: Boolean(triggers.length),
    triggers,
    confidenceScore,
    perspectives: [
      { title: "Scheme fit", status: shortlist.length ? "review" : "attention", summary: shortlist.length ? `${shortlist.length} triage option${shortlist.length === 1 ? "" : "s"} found. Keep as officer consideration only.` : "No reliable scheme shortlist was produced." },
      { title: "Safeguarding / urgency", status: item.urgency?.urgent ? "urgent" : "clear", summary: item.urgency?.urgent ? `${item.urgency.reason || "Urgent language detected"}; consider immediate escalation.` : "No immediate safeguarding trigger detected by the screen." },
      { title: "Missing information", status: majorMissing.length ? "attention" : "clear", summary: majorMissing.length ? `Clarify: ${majorMissing.slice(0, 6).join("; ")}${majorMissing.length > 6 ? "; and other items" : ""}.` : "Core callback facts look sufficient for first review." },
      { title: "Referral opportunities", status: aicReferrals.length ? "review" : "neutral", summary: aicReferrals.length ? `AIC referral considerations: ${aicReferrals.map((scheme) => scheme.name).join("; ")}.` : "No AIC referral option was shortlisted from current evidence." }
    ]
  };
}

function questionForDetail(detail) {
  const map = {
    citizenship: "Can you confirm whether you are a Singapore Citizen, Permanent Resident, or another status?",
    age: "Can you confirm your age?",
    income: "Can you describe your current household income, including work income, CPF payouts, allowances, or other support?",
    family: "Who lives with you, and are there children, elderly persons, or dependants you support?"
  };
  return map[detail] || `Can you clarify ${plainDetail(detail)}?`;
}

function plainDetail(detail = "") {
  return String(detail).replace(/([A-Z])/g, " $1").replace(/[-_]+/g, " ").toLowerCase();
}

function uniqueItems(items) {
  const seen = new Set();
  return items.map((item) => String(item || "").trim()).filter((item) => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function displayEvidence(item) {
  const entries = [
    ...(item.evidence || []),
    ...(item.callerProfile?.characteristics || []).map(({ evidenceId, category, label, value, start, end, sentenceStart, requiresVerification, startWord, endWord }) => ({ id: evidenceId, category, label, text: value, start, end, sentenceStart, requiresVerification, startWord, endWord })),
    ...(item.triage?.shortlist || []).flatMap((scheme) => (scheme.evidenceRefs || []).map(({ id, category, quote, start, end, sentenceStart, startWord, endWord }) => ({ id, category, label: scheme.name || "Scheme evidence", text: quote, start, end, sentenceStart, startWord, endWord })))
  ];
  const seen = new Set();
  return entries.filter((entry) => {
    const key = entry.id || `${entry.category}:${normalEvidenceText(entry.text)}:${Number(entry.start ?? -1).toFixed(2)}`;
    if (!entry.text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildEvidenceWordMarkers(evidence, words, enabled) {
  const markers = new Map();
  if (!enabled || !words.length) return markers;
  evidence.forEach((fact) => {
    const range = evidenceWordRange(fact, words);
    if (!range) return;
    for (let index = range.startWord; index <= range.endWord; index += 1) {
      if (!markers.has(index)) markers.set(index, fact);
    }
  });
  return markers;
}

function evidenceWordRange(fact, words) {
  const indexedRange = numericWordRange(fact, words);
  if (indexedRange) return indexedRange;
  const textRange = textWordRange(fact.text, words);
  if (textRange) return textRange;
  return timedWordRange(fact, words);
}

function numericWordRange(fact, words) {
  const startWord = Number(fact.startWord);
  const endWord = Number(fact.endWord);
  if (!Number.isInteger(startWord) || !Number.isInteger(endWord)) return null;
  if (startWord < 0 || endWord < startWord || endWord >= words.length) return null;
  return { startWord, endWord };
}

function textWordRange(text, words) {
  const phrase = normalEvidenceTokens(text);
  if (!phrase.length) return null;
  const haystack = words.map((word) => normalEvidenceText(word.text));
  for (let index = 0; index <= haystack.length - phrase.length; index += 1) {
    if (phrase.every((token, offset) => haystack[index + offset] === token)) return { startWord: index, endWord: index + phrase.length - 1 };
  }
  return null;
}

function timedWordRange(fact, words) {
  const start = Number(fact.start);
  const end = Number(fact.end);
  if (!Number.isFinite(start)) return null;
  if (!Number.isFinite(end) || end <= start) {
    const nearest = words.findIndex((word) => Number(word.start) >= start || Number(word.end) >= start);
    return nearest >= 0 ? { startWord: nearest, endWord: nearest } : null;
  }
  const selected = words.map((word, index) => ({ word, index })).filter(({ word }) => Number(word.end ?? word.start) > start && Number(word.start ?? word.end) < end);
  if (!selected.length) return null;
  return { startWord: selected[0].index, endWord: selected[selected.length - 1].index };
}

function normalEvidenceTokens(text = "") {
  return String(text).split(/\s+/).map(normalEvidenceText).filter(Boolean);
}

function normalEvidenceText(text = "") {
  return String(text).toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
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
  return updateCase(id, { transcriptText: $("#edit-transcript").value, summary: $("#edit-summary").value, officerProfile: { name: $("#officer-name").value, designation: $("#officer-designation").value, sso: $("#officer-sso").value }, reviewAcknowledgements: { transcriptReviewed: $("#transcript-reviewed").checked, flagsReviewed: $("#flags-reviewed").checked, declaration: $("#officer-declaration").checked } }, { rerender: !silent, silent });
}

async function generateReport(id) {
  await flushAutoSave(id);
  const response = await fetch(`/api/cases/${id}/report`, { method: "POST" });
  if (response.ok) location.href = `/report.html?case=${encodeURIComponent(id)}`;
  else { const body = await response.json(); alert(body.error || "The report could not be generated."); }
}

async function reanalyseAudio(id) {
  await flushAutoSave(id);
  const button = $("#reanalyse-audio");
  if (button) { button.disabled = true; button.textContent = "Reanalysing…"; }
  const response = await fetch(`/api/cases/${id}/reanalyse`, { method: "POST" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (button) { button.disabled = false; button.textContent = "Reanalyse audio"; }
    alert(body.error || "Audio could not be reanalysed.");
    return;
  }
  const updated = await response.json();
  const index = cases.findIndex((item) => item.id === id);
  if (index >= 0) cases[index] = updated;
  renderList();
  renderDetail(id);
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
load();
