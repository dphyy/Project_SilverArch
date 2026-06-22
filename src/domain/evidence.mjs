import { NUMBER_WORDS } from "./numbers.mjs";

const CATEGORY_RULES = [
  {
    category: "name",
    label: "Caller name",
    patterns: [
      { regex: /\b(?:my name is|you can call me)\s+([A-Za-z][A-Za-z'-]{1,30})\b/gi, requiresVerification: false },
      { regex: /\bI(?:'m| am)\s+([A-Za-z][A-Za-z'-]{1,30})[,.]/gi, requiresVerification: true }
    ]
  },
  {
    category: "citizenship",
    label: "Citizenship / residency",
    patterns: [/\b(?:singapore citizen|singaporean|permanent resident|foreign(?:er)?|work permit holder|employment pass holder|not (?:a )?(?:citizen|pr))\b/gi]
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
      /\b(?:i|we)\s+(?:earn|make|get paid|bring home)\s+(?:about|around|only)?\s*(?:s\$|\$)?\s*\d[\d,]*(?:\s+dollars?)?\b/gi,
      /\b(?:no income|zero income|basically zero|low income|no money|sole breadwinner|cannot afford|can't afford|struggling financially|money is tight|behind on bills?|in debt)\b/gi
    ]
  },
  {
    category: "employment",
    label: "Employment",
    patterns: [
      /\b(?:lost my job|lost our job|retrenched|unemployed|jobless|looking for (?:a )?job|unable to work|cannot work|can't work)\b/gi,
      /\b(?:on (?:medical leave|mc)|issued (?:an? )?mc)\b/gi,
      /\b(?:i|we)\s+(?:work|worked)\s+(?:as|part.time|full.time|casual|temporary)[^,.!?]{0,45}/gi
    ]
  },
  {
    category: "family",
    label: "Household and children",
    patterns: [
      new RegExp(`\\b(?:i|we)\\s+have\\s+(?:\\d+|${NUMBER_WORDS})\\s+(?:children|kids?|dependants?)\\b`, "gi"),
      /\b(?:single (?:mother|father|parent)|family of \d+|household of \d+|live with (?:my|our))[^,.!?]{0,45}/gi,
      /\b(?:my|our)\s+(?:son|daughter|child|children|kids?)(?:\s+is|\s+are)?[^,.!?]{0,35}/gi
    ]
  },
  {
    category: "medical",
    label: "Health and medical needs",
    patterns: [/\b(?:medical bills?|hospital bills?|chronic illness|serious illness|disability|disabled|medically unfit|sick|treatment|medication|medicine|hospitalised|hospitalized)[^,.!?]{0,40}/gi]
  },
  {
    category: "wellbeing",
    label: "Wellbeing",
    patterns: [/\b(?:depressed|depression|anxious|anxiety|overwhelmed|distressed|unsafe|in danger|suicid(?:e|al)|kill myself|end my life|family violence)[^,.!?]{0,35}/gi]
  },
  {
    category: "housing",
    label: "Housing",
    patterns: [/\b(?:rent|rental flat|public rental|evict(?:ed|ion)?|homeless|no place to stay|housing)[^,.!?]{0,40}/gi]
  },
  {
    category: "caregiving",
    label: "Caregiving",
    patterns: [/\b(?:caregiver|caregiving|look after|looking after|taking care of|full.time carer)[^,.!?]{0,45}/gi]
  },
  {
    category: "education",
    label: "Children's education / care",
    patterns: [/\b(?:primary school|secondary school|preschool|kindergarten|student care|childcare|school fees?|uniforms?|textbooks?)[^,.!?]{0,40}/gi]
  }
];

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

function sentenceStart(words, wordIndex) {
  let startIndex = wordIndex;
  while (startIndex > 0 && !/[.!?][”"']?$/.test(words[startIndex - 1].text)) startIndex -= 1;
  return Number(words[startIndex]?.start) || 0;
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
