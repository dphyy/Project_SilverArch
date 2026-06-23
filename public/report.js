const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const caseId = params.get("case");
let report; let caseItem;
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const formatTime = (seconds = 0) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

async function load() {
  if (!caseId) return showError("No case was selected.");
  const [caseResponse, reportResponse] = await Promise.all([fetch("/api/cases"), fetch(`/api/cases/${caseId}/report`)]);
  if (!caseResponse.ok || !reportResponse.ok) return showError("The report could not be loaded.");
  caseItem = (await caseResponse.json()).find((item) => item.id === caseId);
  report = await reportResponse.json();
  if (!caseItem) return showError("Case not found.");
  render();
}

function render() {
  const locked = report.status === "finalized";
  const disabled = locked ? "disabled" : "";
  const duration = Math.max(Number(caseItem.audioDurationMs || 0) / 1000, ...(caseItem.transcript?.words || []).map((word) => Number(word.end) || 0), 0);
  $("#report-loading").classList.add("hidden"); $("#report-app").classList.remove("hidden");
  $("#report-app").innerHTML = `
    <section class="report-editor-head"><div><p class="eyebrow">Supporting case report</p><h1>SSO review report</h1><p>Case ${escapeHtml(report.caseId)} · Version ${report.version} · Revision ${report.revision}</p></div><span class="report-status ${report.status}">${report.status === "draft" ? "Draft – for officer review" : "Finalized"}</span></section>
    <div class="report-disclaimer">SilverArch supporting material only. This report does not replace an official scheme form and does not determine eligibility.</div>
    ${caseItem.audioUrl ? `<section class="report-audio"><audio id="report-audio" controls preload="metadata" src="${caseItem.audioUrl}"></audio><span>${formatTime(duration)} recording</span></section>` : '<div class="pending">This fixed fixture has no attached audio.</div>'}
    <div class="report-layout"><article class="report-paper">
      <section><h2>Report metadata</h2><div class="report-field-grid"><label>Officer name<input id="report-officer-name" value="${escapeHtml(report.preparedBy.name)}" ${disabled}></label><label>Designation<input id="report-officer-designation" value="${escapeHtml(report.preparedBy.designation)}" ${disabled}></label><label>Social Service Office<input id="report-officer-sso" value="${escapeHtml(report.preparedBy.sso)}" ${disabled}></label><label>Callback number<input value="${escapeHtml(report.applicant.contactPhone)}" disabled></label></div></section>
      <section><h2>Verified caller summary</h2><textarea id="report-summary" ${disabled}>${escapeHtml(report.applicant.summary)}</textarea></section>
      <section><h2>Presenting circumstances</h2><textarea id="report-presenting" ${disabled}>${escapeHtml(report.sections.presentingCircumstances)}</textarea></section>
      <section><h2>Verified facts</h2><div class="report-facts">${Object.entries(report.facts).map(([key, fact]) => `<article data-report-fact="${key}"><strong>${escapeHtml(fact.label)}</strong><select data-report-fact-status="${key}" ${disabled}><option value="verified" ${fact.status === "verified" ? "selected" : ""}>Verified</option><option value="unknown" ${fact.status === "unknown" ? "selected" : ""}>Unable to verify / not provided</option></select><input data-report-fact-value="${key}" value="${escapeHtml(fact.value || "")}" placeholder="Verified value" ${disabled}><input data-report-fact-explanation="${key}" value="${escapeHtml(fact.explanation || "")}" placeholder="Explanation when unavailable" ${disabled}></article>`).join("")}</div></section>
      <section><h2>Officer assessment</h2><textarea id="report-assessment" ${disabled}>${escapeHtml(report.sections.assessment)}</textarea></section>
      <section><h2>Recommended follow-up</h2><textarea id="report-follow-up" ${disabled}>${escapeHtml(report.sections.recommendedFollowUp)}</textarea></section>
      ${report.sections.safeguardsResolution ? `<section><h2>Safeguards and review flags</h2><textarea id="report-safeguards" ${disabled}>${escapeHtml(report.sections.safeguardsResolution)}</textarea></section>` : '<textarea id="report-safeguards" class="hidden"></textarea>'}
      <section><h2>Schemes for consideration</h2><p class="muted">Triage support only; not an eligibility decision.</p>${report.schemes.map((scheme) => `<article class="report-scheme"><h3>${escapeHtml(scheme.name)}</h3><textarea data-report-scheme="${escapeHtml(scheme.schemeId)}" ${disabled}>${escapeHtml(scheme.reasoning)}</textarea></article>`).join("") || '<p>No automated shortlist was produced.</p>'}</section>
      <section><h2>Verified transcript</h2><textarea id="report-transcript" class="transcript-editor" ${disabled}>${escapeHtml(report.transcripts.verified)}</textarea></section>
      ${report.transcripts.english && report.transcripts.english !== report.transcripts.verified ? `<section><h2>English translation</h2><div class="report-transcript-readonly">${escapeHtml(report.transcripts.english)}</div></section>` : ""}
      ${report.transcripts.original !== report.transcripts.verified ? `<section><h2>Original ASR transcript</h2><div class="report-transcript-readonly">${escapeHtml(report.transcripts.original)}</div></section>` : ""}
      <section><h2>Provider attribution</h2><p>ASR: ${escapeHtml(report.metadata.asrEngine)} · Translation: ${escapeHtml(report.metadata.translationStatus)}${report.metadata.translationProvider ? ` (${escapeHtml(report.metadata.translationProvider)})` : ""} · Report draft: ${escapeHtml(report.metadata.reportDraftProvider || "manual/local")}${report.metadata.reportDraftFallbackReason ? ` after fallback: ${escapeHtml(report.metadata.reportDraftFallbackReason)}` : ""}</p></section>
      <section><h2>Officer declaration</h2><p>${escapeHtml(report.declaration.statement)}</p></section>
    </article><aside class="report-evidence-panel"><h2>Timestamped evidence</h2><p>Use these excerpts while checking the report.</p>${report.evidence.map((item) => `<button class="report-evidence" data-start="${Number(item.sentenceStart ?? item.start) || 0}"><span>${formatTime(item.start)} · ${escapeHtml(item.label)}</span><strong>“${escapeHtml(item.text)}”</strong></button>`).join("") || '<p>No extracted evidence.</p>'}</aside></div>
    <footer class="report-actions">${locked ? `<button id="amend-report" class="secondary">Create amended draft</button><a class="secondary button" href="/api/cases/${caseId}/report/download?version=${report.version}&format=docx">Download DOCX</a><a class="primary button" href="/api/cases/${caseId}/report/download?version=${report.version}&format=pdf">Download PDF</a>` : '<button id="save-report" class="secondary">Save draft</button><button id="finalize-report" class="primary">Finalize report</button>'}<span id="report-save-status" class="muted"></span></footer>`;
  document.querySelectorAll(".report-evidence").forEach((button) => button.addEventListener("click", () => { const audio = $("#report-audio"); if (!audio) return; audio.currentTime = Number(button.dataset.start); audio.play(); }));
  $("#save-report")?.addEventListener("click", saveDraft);
  $("#finalize-report")?.addEventListener("click", finalizeReport);
  $("#amend-report")?.addEventListener("click", createAmendment);
}

function collectPatch() {
  return { preparedBy: { name: $("#report-officer-name").value, designation: $("#report-officer-designation").value, sso: $("#report-officer-sso").value }, applicant: { summary: $("#report-summary").value }, sections: { presentingCircumstances: $("#report-presenting").value, assessment: $("#report-assessment").value, recommendedFollowUp: $("#report-follow-up").value, safeguardsResolution: $("#report-safeguards").value }, facts: Object.fromEntries([...document.querySelectorAll("[data-report-fact]")].map((row) => { const key = row.dataset.reportFact; return [key, { status: row.querySelector(`[data-report-fact-status="${CSS.escape(key)}"]`).value, value: row.querySelector(`[data-report-fact-value="${CSS.escape(key)}"]`).value, explanation: row.querySelector(`[data-report-fact-explanation="${CSS.escape(key)}"]`).value }]; })), schemes: [...document.querySelectorAll("[data-report-scheme]")].map((field) => ({ schemeId: field.dataset.reportScheme, reasoning: field.value })), transcripts: { verified: $("#report-transcript").value } };
}

async function saveDraft() {
  $("#report-save-status").textContent = "Saving…";
  const response = await fetch(`/api/cases/${caseId}/report`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(collectPatch()) });
  if (!response.ok) { $("#report-save-status").textContent = "Save failed."; return false; }
  report = await response.json(); $("#report-save-status").textContent = `Saved revision ${report.revision}.`;
  return true;
}

async function finalizeReport() {
  if (!await saveDraft()) return;
  if (!confirm("Finalize this report version? It will become immutable. Later changes require a new amended version.")) return;
  const response = await fetch(`/api/cases/${caseId}/report/finalize`, { method: "POST" });
  if (!response.ok) { const problem = await response.json(); return alert(problem.readiness?.missing?.map((item) => `• ${item.label}`).join("\n") || problem.error || "Finalization failed."); }
  report = await response.json(); render();
}

async function createAmendment() {
  const response = await fetch(`/api/cases/${caseId}/report`, { method: "POST" });
  if (!response.ok) return alert((await response.json()).error || "An amended draft could not be created.");
  report = await response.json(); render();
}

function showError(message) { $("#report-loading").textContent = message; }
load();
