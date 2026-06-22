export function normalizeSingaporePhone(value = "") {
  const compact = String(value).trim().replace(/[\s-]/g, "").replace(/^\+65/, "");
  if (!/^[3689]\d{7}$/.test(compact)) return null;
  return `+65${compact}`;
}

export function maskPhone(value = "") {
  const normalized = normalizeSingaporePhone(value);
  return normalized ? `+65 •••• ${normalized.slice(-4)}` : "Unavailable";
}
