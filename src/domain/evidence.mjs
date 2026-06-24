import { NUMBER_WORDS } from "./numbers.mjs";

const CATEGORY_RULES = [
  {
    category: "name",
    label: "Caller name",
    patterns: [
      { regex: /\b(?:my name is|you can call me)\s+([A-Za-z][A-Za-z'-]{1,30})\b/gi, requiresVerification: false },
      { regex: /\bI(?:'m| am)\s+(?!from\b|not\b|a\b|an\b|the\b|singaporean\b|singapore\b|in\b|on\b|poor\b|(?:\d{1,3}|[a-z-]+)\s+years?\b)([A-Za-z][A-Za-z'-]{1,30})[,.]/gi, requiresVerification: true }
    ]
  },
  {
    category: "citizenship",
    label: "Citizenship / residency",
    patterns: [/\b(?:singapore citizen|singaporean|permanent resident|foreign(?:er)?|work permit holder|employment pass holder|not (?:a )?(?:citizen|pr)|(?:i am|i'm|am|from)\s+from\s+singapore|from singapore)\b/gi]
  },
  {
    category: "age",
    label: "Age",
    patterns: [new RegExp(`\\b(?:i am|i'm|aged?)\\s+(?:\\d{1,3}|${NUMBER_WORDS})(?:\\s+years?\\s+old)?\\b`, "gi")]
  },
  {
    category: "income",
    label: "Income and finances",
    patterns: [
      /\b(?:household|monthly|per capita|my)?\s*(?:income|salary|pay|earnings?)\s+(?:is|are|was|about|around|only)?\s*(?:s\$|\$)?\s*\d[\d,]*(?:\s+dollars?)?\b/gi,
      /\b(?:household|monthly|per capita|my)?\s*(?:income|salary|pay|earnings?)\s+(?:is|are|was)?\s*(?:basically\s+)?(?:zero|low|nothing|none)\b/gi,
      /\b(?:i|we)\s+(?:earn|make|get paid|bring home)\s+(?:about|around|only)?\s*(?:s\$|\$)?\s*\d[\d,]*(?:\s+dollars?)?\b/gi,
      /\b(?:fees?|income|salary|allowance|assistance|payout|cash|money)[^,.!?]{0,60}\b(?:insufficient|not enough|too little|cannot cover|can't cover|not sufficient)[^,.!?]{0,60}\b(?:electricity|utilities?|power|water|bills?|expenses?|usage|fees?)\b/gi,
      /\b(?:electricity|utilities?|utility|power|water|gas|sp|s&cc|conservancy)\s+(?:bills?|fees?|charges?|usage|expenses?)[^,.!?]{0,45}\b(?:expensive|high|costly|too much|cannot afford|can't afford|hard to pay|unable to pay|overdue|arrears?)\b/gi,
      /\b(?:expensive|high|costly|overdue)\s+(?:electricity|utilities?|utility|power|water|gas|sp|s&cc|conservancy)\s+(?:bills?|fees?|charges?|usage|expenses?)\b/gi,
      /\b(?:no income|zero income|basically zero|low income|no money|sole breadwinner|cannot afford|can't afford|can't earn money|cannot earn money|don't have enough money|do not have enough money|not enough money|struggling financially|money is tight|behind on bills?|household expenses?|utility bills?|electricity bills?|water bills?|power bills?|sp bills?|s&cc|conservancy fees?|school fees?|food expenses?|in debt)\b/gi
    ]
  },
  {
    category: "employment",
    label: "Employment",
    patterns: [
      /\b(?:lost my job|lost our job|retrenched|unemployed|jobless|not working|no work|have no work|looking for (?:a )?job|unable to work|cannot work|can't work)\b/gi,
      /\b(?:on (?:medical leave|mc)|issued (?:an? )?mc)\b/gi,
      /\b(?:i|we)\s+(?:am|are|was|were)\s+(?:a|an)?\s*[^,.!?]{0,35}\b(?:driver|worker|employee|staff|cashier|cleaner|guard|delivery rider|hawker|assistant)\b/gi,
      /\b(?:i|we)\s+(?:work|worked)\s+(?:as|part.time|full.time|casual|temporary)[^,.!?]{0,45}/gi
    ]
  },
  {
    category: "family",
    label: "Household and children",
    patterns: [
      new RegExp(`\\b(?:i|we)\\s+have\\s+(?:\\d+|${NUMBER_WORDS})\\s+(?:children|kids?|dependants?)(?:\\s+aged?[^,.!?]{0,25})?\\b`, "gi"),
      /\b(?:single (?:mother|father|parent)|family of \d+|household of \d+|live with (?:my|our))[^,.!?]{0,45}/gi,
      /\b(?:my|our)\s+(?:son|daughter|child|children|kids?)(?:\s+is|\s+are)?[^,.!?]{0,35}/gi
    ]
  },
  {
    category: "medical",
    label: "Health and medical needs",
    patterns: [
      /\b(?:medical bills?|hospital bills?|clinic bills?|doctor bills?|chronic illness|serious illness|disability|disabled|severe disability|severely disabled|bedbound|medically unfit|poor health|bone pain|body pain|dementia|stroke|frail|seeing doctors?|suffer from [^,.!?]{1,35}|sick|treatment|medication|medicine|hospitalised|hospitalized|injured my [^,.!?]{1,24})[^,.!?]{0,40}/gi,
      /\b(?:activities of daily living|ADLs?|cannot (?:bathe|bath|shower|dress|toilet|feed|eat|walk|transfer)|needs? help (?:bathing|showering|dressing|toileting|feeding|transferring))[^,.!?]{0,45}/gi,
      /\b(?:wheelchair|walking frame|walking stick|mobility aid|assistive device|commode|hospital bed|fall risk|difficulty walking)[^,.!?]{0,45}/gi
    ]
  },
  {
    category: "wellbeing",
    label: "Wellbeing",
    patterns: [/\b(?:depressed|depression|anxious|anxiety|overwhelmed|distressed|unsafe|in danger|suicid(?:e|al)|kill myself|end my life|don'?t want to (?:live|be alive)|do not want to (?:live|be alive)|not safe for myself|cannot wait until tomorrow|can'?t wait until tomorrow|need someone to talk to now|family violence)[^,.!?]{0,35}/gi]
  },
  {
    category: "housing",
    label: "Housing",
    patterns: [/\b(?:rent|rental flat|public rental|evict(?:ed|ion)?|homeless|no place to stay|housing)[^,.!?]{0,40}/gi]
  },
  {
    category: "caregiving",
    label: "Caregiving",
    patterns: [
      /\b(?:caregiver|caregiving|look after|looking after|take care of|taking care of|care for|full.time carer)[^,.!?]{0,55}/gi,
      /\b(?:caregiver training|training course|learn to care|caregiving skills|dementia care|wound care|how to care)[^,.!?]{0,55}/gi,
      /\b(?:help (?:with|to) (?:bathe|bath|shower|dress|toilet|feed|eat|transfer)|assist(?:ing)? (?:with )?(?:bathing|showering|dressing|toileting|feeding|transferring))[^,.!?]{0,55}/gi
    ]
  },
  {
    category: "education",
    label: "Children's education / care",
    patterns: [/\b(?:primary school|secondary school|preschool|kindergarten|student care|childcare|school fees?|uniforms?|textbooks?)[^,.!?]{0,40}/gi]
  }
];

const CATEGORY_LABELS = Object.fromEntries(CATEGORY_RULES.map((rule) => [rule.category, rule.label]));

function indexedTranscript(words) {
  let text = "";
  const offsets = [];
  words.forEach((word, index) => {
    if (text) text += " ";
    const start = text.length;
    text += word.text;
    offsets.push({ index, start, end: text.length });
  });
  return { text, offsets };
}

function wordRange(offsets, matchStart, matchEnd) {
  const selected = offsets.filter((word) => word.end > matchStart && word.start < matchEnd);
  if (!selected.length) return null;
  return { startWord: selected[0].index, endWord: selected[selected.length - 1].index };
}

export function extractEvidence(transcript = {}) {
  const words = transcript.words || transcript.segments || [];
  if (!words.length) return [];
  const { text, offsets } = indexedTranscript(words);
  const evidence = [];

  for (const rule of CATEGORY_RULES) {
    for (const patternDefinition of rule.patterns) {
      const pattern = patternDefinition.regex || patternDefinition;
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const range = wordRange(offsets, match.index, match.index + match[0].length);
        if (!range) continue;
        const startWord = words[range.startWord];
        const endWord = words[range.endWord];
        const duplicate = evidence.some((item) => item.category === rule.category && item.startWord <= range.endWord && item.endWord >= range.startWord);
        if (!duplicate) evidence.push({
          id: `${rule.category}-${range.startWord}-${range.endWord}`,
          category: rule.category,
          label: rule.label,
          text: words.slice(range.startWord, range.endWord + 1).map((word) => word.text).join(" "),
          start: startWord.start,
          end: endWord.end,
          sentenceStart: sentenceStart(words, range.startWord),
          requiresVerification: Boolean(patternDefinition.requiresVerification),
          ...range
        });
      }
    }
  }

  return evidence.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function evidenceFromQuote(transcript = {}, { category, label, quote, text, requiresVerification = false, source = "model" } = {}) {
  const words = transcript.words || transcript.segments || [];
  if (!words.length || !CATEGORY_LABELS[category]) return null;
  const range = quoteWordRange(words, quote || text);
  if (!range) return null;
  const startWord = words[range.startWord];
  const endWord = words[range.endWord];
  return {
    id: `${source}-${category}-${range.startWord}-${range.endWord}`,
    category,
    label: label || CATEGORY_LABELS[category],
    text: words.slice(range.startWord, range.endWord + 1).map((word) => word.text).join(" "),
    start: startWord.start,
    end: endWord.end,
    sentenceStart: sentenceStart(words, range.startWord),
    requiresVerification: Boolean(requiresVerification),
    source,
    ...range
  };
}

export function mergeEvidence(...groups) {
  const merged = [];
  for (const item of groups.flat().filter(Boolean).sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0) || String(a.text).length - String(b.text).length)) {
    const duplicate = merged.some((existing) => {
      const sameCategoryOverlap = existing.category === item.category && Number.isInteger(existing.startWord) && Number.isInteger(existing.endWord) && Number.isInteger(item.startWord) && Number.isInteger(item.endWord) && existing.startWord <= item.endWord && existing.endWord >= item.startWord;
      const sameQuote = existing.category === item.category && normalizeEvidenceText(existing.text) === normalizeEvidenceText(item.text);
      return sameCategoryOverlap || sameQuote;
    });
    if (!duplicate) merged.push(item);
  }
  return merged.sort((a, b) => a.start - b.start || a.end - b.end);
}

function sentenceStart(words, wordIndex) {
  let startIndex = wordIndex;
  while (startIndex > 0 && !/[.!?][”"']?$/.test(words[startIndex - 1].text)) startIndex -= 1;
  return Number(words[startIndex]?.start) || 0;
}

function quoteWordRange(words, quote = "") {
  const phrase = String(quote).split(/\s+/).map(normalizeEvidenceText).filter(Boolean);
  if (!phrase.length) return null;
  const haystack = words.map((word) => normalizeEvidenceText(word.text));
  for (let index = 0; index <= haystack.length - phrase.length; index += 1) {
    if (phrase.every((token, offset) => haystack[index + offset] === token)) return { startWord: index, endWord: index + phrase.length - 1 };
  }
  return null;
}

function normalizeEvidenceText(text = "") {
  return String(text).toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

export function buildCallerProfile(evidence = []) {
  const byCategory = evidence.reduce((groups, item) => {
    (groups[item.category] ||= []).push(item);
    return groups;
  }, {});
  const present = [...new Set(evidence.map((item) => item.label))];
  const priority = ["name", "wellbeing", "medical", "income", "employment", "housing", "caregiving", "family", "education", "citizenship", "age"];
  const seenCharacteristics = new Set();
  const characteristics = priority.flatMap((category) => (byCategory[category] || []).filter((item) => {
    const key = `${category}:${item.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    if (seenCharacteristics.has(key)) return false;
    seenCharacteristics.add(key);
    return true;
  }).slice(0, 2).map((item) => ({ category, label: item.label, value: item.text, start: item.start, sentenceStart: item.sentenceStart, requiresVerification: item.requiresVerification, evidenceId: item.id })));
  return {
    summary: present.length
      ? `Caller mentioned ${present.slice(0, 4).join(", ").toLowerCase()}${present.length > 4 ? ` and ${present.length - 4} other relevant area${present.length - 4 === 1 ? "" : "s"}` : ""}. These are intake signals for officer review, not eligibility findings.`
      : "No scheme-relevant personal or hardship details were confidently identified. The officer should review the audio and request missing information.",
    characteristics,
    missingCoreDetails: ["citizenship", "age", "income", "family"].filter((category) => !byCategory[category]?.length)
  };
}
