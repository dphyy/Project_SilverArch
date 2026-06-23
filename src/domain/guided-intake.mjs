import { extractTypedFacts } from "./facts.mjs";
import { screenUrgency } from "./urgency.mjs";

export const GUIDED_FIELDS = [
  {
    id: "situation",
    label: "Situation and requested help",
    question: "Please tell me what happened and what help you need now.",
    detected: (text) => text.trim().split(/\s+/).length >= 8
  },
  {
    id: "safety",
    label: "Immediate safety risk",
    question: "Before we continue, are you or anyone with you in immediate danger tonight?",
    detected: (text) => /\b(?:yes|no|danger|safe|unsafe|emergency|attacking|violence|suicid|self harm|end my life|kill myself)\b/i.test(text)
  },
  {
    id: "citizenship",
    label: "Citizenship or residency",
    question: "Are you a Singapore citizen, permanent resident, or another residency status?",
    detected: (_text, facts) => Boolean(facts.citizenship)
  },
  {
    id: "applicantAge",
    label: "Applicant age",
    question: "How old are you?",
    detected: (_text, facts) => Number.isFinite(facts.applicantAge)
  },
  {
    id: "householdIncome",
    label: "Monthly household income",
    question: "What is your current monthly household income, even if it is zero?",
    detected: (_text, facts) => facts.householdIncome !== null && facts.householdIncome !== undefined
  },
  {
    id: "householdSize",
    label: "Household size",
    question: "How many people live in your household, including you?",
    detected: (_text, facts) => Number.isFinite(facts.householdSize)
  },
  {
    id: "employment",
    label: "Employment or work interruption",
    question: "Are you working now, or did work stop recently because of job loss, illness, caregiving, or another reason?",
    detected: (_text, facts) => Boolean(facts.employment)
  }
];

export function guidedIntakeState(turns = []) {
  const callerText = buildGuidedTranscript(turns);
  const asked = new Set(turns.map((turn) => turn.fieldId).filter(Boolean));
  const facts = extractTypedFacts(callerText);
  const urgency = screenUrgency(callerText);
  const fields = GUIDED_FIELDS.map((field) => {
    const answered = Boolean(field.detected(callerText, facts));
    return { id: field.id, label: field.label, question: field.question, asked: asked.has(field.id), answered };
  });
  const next = urgency.urgent
    ? null
    : fields.find((field) => !field.answered && !field.asked) || fields.find((field) => !field.answered) || null;
  return {
    callerText,
    facts,
    urgency,
    fields,
    complete: !next,
    nextQuestion: next ? { fieldId: next.id, label: next.label, text: next.question } : null
  };
}

export function buildGuidedTranscript(turns = []) {
  return turns
    .filter((turn) => String(turn.answerText || "").trim())
    .map((turn) => contextualizeGuidedAnswer(turn))
    .join(" ");
}

function contextualizeGuidedAnswer(turn) {
  const answer = String(turn.answerText || "").trim();
  if (!answer) return "";
  if (turn.fieldId === "applicantAge") return `My age is ${answer}.`;
  if (turn.fieldId === "householdIncome") return `My monthly household income is ${answer}.`;
  if (turn.fieldId === "householdSize") return `My household is a family of ${answer}.`;
  if (turn.fieldId === "citizenship") return `My citizenship or residency status is ${answer}.`;
  if (turn.fieldId === "employment") return `My employment situation is ${answer}.`;
  if (turn.fieldId === "safety") return `Immediate safety risk: ${answer}.`;
  return answer;
}

export function wordsFromText(text = "", durationMs = 0) {
  const tokens = String(text).split(/\s+/).filter(Boolean);
  const durationSeconds = Math.max(tokens.length * 0.35, Number(durationMs || 0) / 1000, 0);
  const step = tokens.length ? durationSeconds / tokens.length : 0;
  return tokens.map((token, index) => ({ text: token, start: index * step, end: (index + 1) * step }));
}
