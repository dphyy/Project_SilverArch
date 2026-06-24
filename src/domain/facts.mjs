import { NUMBER_WORDS, parseSpokenNumber } from "./numbers.mjs";

function firstNumber(text, regex) {
  const match = regex.exec(text);
  return match ? parseSpokenNumber(match[1]) : null;
}

export function extractTypedFacts(text = "") {
  const applicantAge = firstNumber(text, new RegExp(`\\b(?:i am|i'm|my age is)\\s+(${NUMBER_WORDS}|\\d{1,3})(?:\\s+years?\\s+old)?`, "i"));
  const householdIncome = /\b(?:no income|zero income|basically zero|income[^.!?]{0,45}\bzero)\b/i.test(text) ? 0 : firstNumber(text, /\b(?:monthly household income|household income|income|salary|earn|make|get paid)[^\d$]{0,20}(?:s\$|\$)?\s*([\d,]+)/i);
  const householdSize = firstNumber(text, new RegExp(`\\b(?:family|household) of (${NUMBER_WORDS}|\\d{1,2})`, "i"));
  const childAges = [...text.matchAll(new RegExp(`\\b(?:child|son|daughter)[^.!?]{0,25}?(?:is|aged?)\\s+(${NUMBER_WORDS}|\\d{1,2})`, "gi"))].map((match) => parseSpokenNumber(match[1])).filter(Number.isFinite);
  const citizenship = /\b(?:singapore citizen|singaporean|i am (?:an? )?sc)\b/i.test(text) ? "citizen" : /\b(?:permanent resident|i am (?:an? )?pr)\b/i.test(text) ? "pr" : /\b(?:foreigner|work permit|employment pass|not (?:a )?(?:citizen|pr))\b/i.test(text) ? "other" : null;
  const childCitizenship = /\b(?:child|son|daughter|student)\s+(?:is\s+)?(?:a\s+)?(?:singapore citizen|singaporean)\b/i.test(text) ? "citizen" : /\b(?:child|son|daughter|student)\s+(?:is\s+)?(?:a\s+)?(?:permanent resident|pr)\b/i.test(text) ? "pr" : null;
  const adlAssistance = /\b(?:activities of daily living|ADLs?|help (?:with|to) (?:bathe|bath|shower|dress|toilet|feed|eat|transfer)|cannot (?:bathe|bath|shower|dress|toilet|feed|eat|walk|transfer)|needs? help (?:bathing|showering|dressing|toileting|feeding|transferring))\b/i.test(text) ? true : null;
  const mobilityAidNeed = /\b(?:wheelchair|walking frame|walking stick|mobility aid|assistive device|commode|hospital bed|fall risk|falls? down|difficulty walking|cannot walk)\b/i.test(text) ? true : null;
  const caregiverTrainingNeed = /\b(?:caregiver training|training course|learn to care|caregiving skills|dementia care|wound care|how to care)\b/i.test(text) ? true : null;
  const severeDisability = /\b(?:severe disability|severely disabled|bedbound|cannot (?:bathe|dress|toilet|feed|transfer)|needs? help with (?:most|all) (?:daily activities|ADLs?))\b/i.test(text) ? true : null;
  return {
    citizenship,
    childCitizenship,
    applicantAge,
    childAges,
    householdIncome,
    householdSize,
    employment: /\b(?:lost my job|retrenched|unemployed|jobless|cannot work|can't work|unable to work|on mc)\b/i.test(text) ? "not-working-or-interrupted" : /\b(?:work as|working|employed|grab driver|part.time|full.time)\b/i.test(text) ? "working" : null,
    medicalCertification: /\b(?:doctor|medical officer)\s+(?:certified|confirmed)|medical (?:certificate|certification).*unable to work\b/i.test(text) ? true : null,
    publicHealthcareInstitution: /\b(?:public|subsidised|subsidized|government)\s+(?:hospital|healthcare institution|clinic)\b/i.test(text) ? true : /\bprivate hospital\b/i.test(text) ? false : null,
    governmentSchool: /\b(?:government|government.aided)\s+(?:primary|secondary|special)?\s*school\b/i.test(text) ? true : null,
    eligiblePreschool: /\b(?:licensed|anchor operator|moe)\s+(?:preschool|kindergarten|childcare centre)\b/i.test(text) ? true : null,
    studentCareEnrolled: /\b(?:enrolled|attends?|goes to)\s+(?:an?\s+)?(?:msf.registered\s+)?student care/i.test(text) ? true : null,
    adlAssistance,
    mobilityAidNeed,
    caregiverTrainingNeed,
    severeDisability,
    hardship: {
      jobLoss: /\b(?:lost my job|retrenched|no income|income.*zero)\b/i.test(text),
      medical: /\b(?:medical bills?|hospital bills?|disability|illness|injured|on mc)\b/i.test(text),
      utilities: /\b(?:electricity|utilities?|utility|power|water|gas|sp|s&cc|conservancy)\s+(?:bills?|fees?|charges?|usage|expenses?)|(?:fees?|income|salary|allowance|assistance|payout|cash|money)[^.!?]{0,60}(?:insufficient|not enough|too little|cannot cover|can't cover|not sufficient)[^.!?]{0,60}(?:electricity|utilities?|power|water|bills?|expenses?|usage|fees?)\b/i.test(text),
      caregiving: /\b(?:caregiver|caregiving|look after|taking care|care for)\b/i.test(text),
      disability: /\b(?:disability|disabled|severe disability|bedbound|ADLs?|activities of daily living)\b/i.test(text),
      mobility: /\b(?:wheelchair|walking frame|mobility aid|assistive device|difficulty walking|cannot walk)\b/i.test(text),
      eldercare: /\b(?:elderly|senior|aged parent|old mother|old father|frail)\b/i.test(text),
      estrangement: /\b(?:estranged|no contact|family cannot|family can't)\b/i.test(text),
      housing: /\b(?:rent|rental|evict|homeless|no place to stay)\b/i.test(text)
    }
  };
}
