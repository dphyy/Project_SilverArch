const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

export function parseSpokenNumber(value = "") {
  const numeric = String(value).replaceAll(",", "").match(/\d+(?:\.\d+)?/);
  if (numeric) return Number(numeric[0]);
  const tokens = String(value).toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let seen = false;
  for (const token of tokens) {
    if (token in ONES) { current += ONES[token]; seen = true; }
    else if (token in TENS) { current += TENS[token]; seen = true; }
    else if (token === "hundred") { current = Math.max(1, current) * 100; seen = true; }
    else if (token === "thousand") { total += Math.max(1, current) * 1000; current = 0; seen = true; }
  }
  return seen ? total + current : null;
}

export const NUMBER_WORDS = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?";
