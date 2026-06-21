const $ = (selector) => document.querySelector(selector);
let cases = [];

const escapeHtml = (value = "") => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
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
  $("#case-list").innerHTML = cases.length ? cases.map((item) => `
    <button class="case-card ${item.urgency?.urgent ? "urgent" : ""}" data-id="${item.id}">
      <span><strong>${item.urgency?.urgent ? "Urgent risk" : "Voice intake"}</strong><small>${new Date(item.createdAt).toLocaleString("en-SG")}</small></span>
      <span><em>${waiting(item.createdAt)}</em><small>${item.transcript.asrEngine || "ASR failed"}</small></span>
    </button>`).join("") : '<div class="empty-card"><strong>No cases yet</strong><p>Use the 2am demo clock on the citizen page to submit a recording.</p></div>';
  document.querySelectorAll(".case-card").forEach((button) => button.addEventListener("click", () => renderDetail(button.dataset.id)));
}

function renderDetail(id) {
  const item = cases.find((entry) => entry.id === id);
  const flags = [
    ...(item.urgency?.urgent ? [{ kind: "urgent", text: `${item.urgency.reason}: ${item.urgency.resource}` }] : []),
    ...(item.reviewReasons || []).map((text) => ({ kind: "confidence", text })),
    ...(item.piiProposals || []).map((proposal) => ({ kind: "pii", text: `${proposal.type} needs officer confirmation` }))
  ];
  const words = item.transcript.words || item.transcript.segments || [];
  const evidence = item.evidence || [];
  const evidenceForWord = (index) => evidence.find((item) => index >= item.startWord && index <= item.endWord);
  const transcriptHtml = words.length
    ? words.map((word, index) => {
      const marker = evidenceForWord(index);
      const classes = marker ? `word seek-audio evidence-word evidence-${marker.category}` : "word seek-audio";
      const title = marker ? `${marker.label} · play from ${Number(word.start || 0).toFixed(1)}s` : `Play from ${Number(word.start || 0).toFixed(1)}s`;
      return `<button class="${classes}" data-start="${Number(word.start) || 0}" title="${escapeHtml(title)}">${escapeHtml(word.text)}</button>`;
    }).join(" ")
    : escapeHtml(item.transcript.text || "No transcript available. Review the raw audio.");
  const shortlist = item.triage?.shortlist || [];
  const profile = item.callerProfile || { summary: "This case predates automatic evidence extraction. Submit a new recording to generate a caller rundown.", characteristics: [], missingCoreDetails: [] };
  $("#case-detail").className = "detail";
  $("#case-detail").innerHTML = `
    <div class="detail-head"><div><p class="eyebrow">Case ${item.id.slice(0, 8)}</p><h2>Citizen testimony</h2></div><span class="badge">${escapeHtml(item.status)}</span></div>
    <audio id="case-audio" controls src="${item.audioUrl}"></audio>
    <section><h3>Review flags</h3><div class="flag-list">${flags.length ? flags.map((flag) => `<div class="flag ${flag.kind}">${escapeHtml(flag.text)}</div>`).join("") : '<p class="muted">No flags raised.</p>'}</div></section>
    <section><div class="section-head"><h3>Transcript</h3><span class="engine">ASR: ${escapeHtml(item.transcript.asrEngine || "failed")}${item.transcript.languageCode ? ` · ${escapeHtml(item.transcript.languageCode)}` : ""}</span></div><div class="evidence-legend"><span class="dot identity"></span>Personal details <span class="dot financial"></span>Financial <span class="dot wellbeing"></span>Health / wellbeing <span class="dot family"></span>Family / care</div><div class="transcript">${transcriptHtml}</div><p class="audit">Highlighted phrases are evidence signals. Click any word to replay its exact audio moment.${item.transcript.fallbackReason ? ` Fallback reason: ${escapeHtml(item.transcript.fallbackReason)}` : ""}</p>
      <div class="caller-rundown"><p class="eyebrow">Quick caller rundown</p><p>${escapeHtml(profile.summary)}</p><div class="characteristics">${profile.characteristics?.length ? profile.characteristics.map((fact) => `<button class="characteristic seek-audio evidence-${fact.category}" data-start="${Number(fact.start) || 0}"><span>${escapeHtml(fact.label)}</span><strong>“${escapeHtml(fact.value)}”</strong><small>Play evidence at ${Number(fact.start || 0).toFixed(1)}s</small></button>`).join("") : '<p class="muted">No key characteristics were automatically identified.</p>'}</div>${profile.missingCoreDetails?.length ? `<div class="missing-details"><strong>Ask next:</strong> ${escapeHtml(profile.missingCoreDetails.join(", "))}</div>` : ""}</div>
    </section>
    <section><div class="section-head"><h3>Scheme shortlist</h3><span class="engine">${escapeHtml(item.triage?.status || "pending")}</span></div><div class="shortlist">${shortlist.length ? shortlist.map((scheme) => `<article class="scheme-card"><div><strong>${escapeHtml(scheme.name)}</strong><span class="score">${escapeHtml(scheme.softScore)}</span></div><p>${escapeHtml(scheme.reasoning)}</p>${scheme.insufficientInformation?.length ? `<div class="flag confidence">Missing: ${escapeHtml(scheme.insufficientInformation.join(", "))}</div>` : ""}${scheme.appealRelevant?.length ? `<div class="flag appeal">Appeal context: ${escapeHtml(scheme.appealRelevant.join("; "))}</div>` : ""}</article>`).join("") : '<div class="pending">No automated shortlist. Review the raw audio manually.</div>'}</div></section>
    <section><h3>Audit trail</h3><div class="audit-list">${(item.auditEvents || []).map((event) => `<p><strong>${escapeHtml(event.action)}</strong> · ${new Date(event.at).toLocaleString("en-SG")}<br><span>${escapeHtml(event.detail || "")}</span></p>`).join("") || '<p class="muted">No audit events recorded.</p>'}</div></section>
    <div class="actions"><button class="secondary" data-action="needs-review">Keep in review</button><button class="secondary" data-action="escalated">Escalate</button><button class="primary" data-action="accepted">Accept review</button></div>`;
  document.querySelectorAll(".seek-audio").forEach((word) => word.addEventListener("click", () => {
    const audio = $("#case-audio");
    audio.currentTime = Number(word.dataset.start);
    audio.play();
  }));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => updateStatus(item.id, button.dataset.action)));
}

async function updateStatus(id, status) {
  const response = await fetch(`/api/cases/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
  if (!response.ok) return;
  const updated = await response.json();
  cases = cases.map((item) => item.id === id ? updated : item);
  renderList();
  renderDetail(id);
}

async function load() {
  cases = await fetch("/api/cases").then((response) => response.json());
  cases.sort((a, b) => Number(b.urgency?.urgent) - Number(a.urgency?.urgent) || new Date(a.createdAt) - new Date(b.createdAt));
  renderList();
}

$("#refresh").addEventListener("click", load);
load();
