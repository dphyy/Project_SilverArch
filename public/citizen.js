const $ = (selector) => document.querySelector(selector);
const panels = ["#open-panel", "#language-panel", "#consent-panel", "#record-panel", "#contact-panel", "#done-panel"];
const PROMPTS = ["greeting", "consent", "recording-instructions"];
let gate;
let recorder;
let chunks = [];
let recording;
let timer;
let startedAt;
let recordingDurationMs = 0;
let previewUrl;
let language = "en";
let promptAudio;

const COPY = {
  en: {
    statusChecked: "Singapore time checked", demoTime: "Demo time active", titleOpen: "A live officer is available", titleAnswered: "SilverArch has answered",
    openLead: "The ComCare hotline is open daily from 7am to midnight.", closedLead: "The live hotline is closed. You can leave a voice account for next-day review.",
    openMessage: "A live ComCare officer is available now. SilverArch does not record during hotline hours.", callHotline: "Call 1800-222-0000",
    chooseKicker: "Choose language", chooseTitle: "How would you like to continue?", playGreeting: "Play greeting", playConsent: "Play consent", playInstructions: "Play instructions",
    consentNotice: "<strong>No live officer is on this channel.</strong> Your recording will be reviewed on the next working day. Tone and pacing may help an officer prioritise review.",
    consentLabel: "I agree to have my voice recorded and transcribed for ComCare intake.", continue: "Continue",
    recordHeading: "Please introduce yourself first, then tell us what happened and what help you need.",
    promptIntro: "To help the officer understand your situation, please mention:",
    promptItems: ["Your name, age and citizenship or residency status", "Your work situation and monthly household income", "Who lives with you, including the number and ages of your children", "Housing, medical, caregiving, school or other major expenses", "What changed recently and what help you need now"],
    promptSmall: "You do not need to state your NRIC. Speak naturally and include only what you are comfortable sharing.",
    tapStart: "Tap the circle to start.", recording: "Recording… tap again when done.", review: "Listen back, record again, or continue to contact details.", mic: "Microphone access is needed to record your account.", recordAgain: "Record again",
    contactKicker: "Contact details", contactTitle: "How can an officer reach you?", contactNotice: "Your phone number is collected so a Social Service Officer can contact you after reviewing your case.", phoneLabel: "Singapore phone number", phoneHelp: "Enter an 8-digit number, with or without +65.", submit: "Send for review", back: "Back to recording", invalidPhone: "Enter a valid 8-digit Singapore phone number.", sending: "Sending securely…", sendFail: "The recording could not be sent.",
    doneTitle: "Recording received", doneMessage: "An officer can review it on the next working day. If your safety is at risk now, call <strong>999</strong> or <strong>1-767</strong>.", urgentTitle: "Please get help now", urgentMessage: (resource) => `Your recording was received, but it may describe an immediate safety risk. Contact <strong>${resource}</strong> now rather than waiting for next-day review.`,
    emergency: 'Immediate danger? Call <a href="tel:999">999</a>. Mental health crisis? Call <a href="tel:1767">1-767</a>.'
  },
  zh: {
    statusChecked: "已检查新加坡时间", demoTime: "演示时间已启用", titleOpen: "现在有热线人员接听", titleAnswered: "SilverArch 已接听",
    openLead: "ComCare 热线每日早上 7 点至午夜开放。", closedLead: "热线目前已关闭。您可以留下语音说明，工作人员会在下一个工作日查看。",
    openMessage: "现在有 ComCare 热线人员接听。热线开放时，SilverArch 不会录音。", callHotline: "拨打 1800-222-0000",
    chooseKicker: "选择语言", chooseTitle: "您想用哪种语言继续？", playGreeting: "播放问候", playConsent: "播放同意说明", playInstructions: "播放说明",
    consentNotice: "<strong>此频道没有即时人员接听。</strong> 您的录音会在下一个工作日由工作人员查看。语气和语速可能有助于工作人员优先处理。",
    consentLabel: "我同意录下我的声音并转成文字，用于 ComCare 初步了解情况。", continue: "继续",
    recordHeading: "请先介绍自己，然后说明发生了什么事，以及您需要什么帮助。",
    promptIntro: "为了帮助工作人员了解您的情况，请尽量说明：",
    promptItems: ["您的姓名、年龄、公民或居留身份", "您的工作情况和每月家庭收入", "与您同住的人，包括孩子人数和年龄", "住房、医疗、照护、学校或其他主要开支", "最近发生了什么变化，以及现在需要什么帮助"],
    promptSmall: "您不需要说出 NRIC。请自然说明，只分享您愿意提供的资料。",
    tapStart: "点击圆圈开始录音。", recording: "录音中……完成后请再点一次。", review: "请回听、重新录音，或继续填写联系方式。", mic: "需要麦克风权限才能录音。", recordAgain: "重新录音",
    contactKicker: "联系方式", contactTitle: "工作人员可以怎样联系您？", contactNotice: "收集您的电话号码，是为了让社会服务人员在查看个案后联系您。", phoneLabel: "新加坡电话号码", phoneHelp: "请输入 8 位号码，可包含或不包含 +65。", submit: "提交审核", back: "返回录音", invalidPhone: "请输入有效的 8 位新加坡电话号码。", sending: "正在安全提交……", sendFail: "录音无法提交。",
    doneTitle: "已收到录音", doneMessage: "工作人员可在下一个工作日查看。如果您现在有安全风险，请拨打 <strong>999</strong> 或 <strong>1-767</strong>。", urgentTitle: "请立即寻求帮助", urgentMessage: (resource) => `我们已收到录音，但内容可能涉及即时安全风险。请现在联系 <strong>${resource}</strong>，不要等到下一个工作日。`,
    emergency: '有即时危险？请拨打 <a href="tel:999">999</a>。心理危机？请拨打 <a href="tel:1767">1-767</a>。'
  },
  ms: {
    statusChecked: "Masa Singapura disemak", demoTime: "Masa demo aktif", titleOpen: "Pegawai talian sedang tersedia", titleAnswered: "SilverArch telah menjawab",
    openLead: "Talian ComCare dibuka setiap hari dari 7 pagi hingga tengah malam.", closedLead: "Talian langsung telah ditutup. Anda boleh tinggalkan rakaman suara untuk semakan hari bekerja seterusnya.",
    openMessage: "Pegawai ComCare tersedia sekarang. SilverArch tidak merakam semasa waktu talian dibuka.", callHotline: "Hubungi 1800-222-0000",
    chooseKicker: "Pilih bahasa", chooseTitle: "Bagaimana anda ingin teruskan?", playGreeting: "Mainkan ucapan", playConsent: "Mainkan persetujuan", playInstructions: "Mainkan arahan",
    consentNotice: "<strong>Tiada pegawai langsung di saluran ini.</strong> Rakaman anda akan disemak pada hari bekerja seterusnya. Nada dan kelajuan percakapan boleh membantu pegawai mengutamakan semakan.",
    consentLabel: "Saya bersetuju suara saya dirakam dan ditranskripsikan untuk pengambilan ComCare.", continue: "Teruskan",
    recordHeading: "Sila perkenalkan diri dahulu, kemudian beritahu apa yang berlaku dan bantuan yang diperlukan.",
    promptIntro: "Untuk membantu pegawai memahami keadaan anda, sila nyatakan:",
    promptItems: ["Nama, umur dan status kewarganegaraan atau kediaman anda", "Keadaan pekerjaan dan pendapatan isi rumah bulanan", "Siapa tinggal bersama anda, termasuk bilangan dan umur anak", "Perbelanjaan perumahan, perubatan, penjagaan, sekolah atau utama lain", "Apa yang berubah baru-baru ini dan bantuan yang anda perlukan sekarang"],
    promptSmall: "Anda tidak perlu menyatakan NRIC. Bercakap secara semula jadi dan kongsi hanya perkara yang anda selesa kongsi.",
    tapStart: "Tekan bulatan untuk mula.", recording: "Sedang merakam… tekan sekali lagi apabila selesai.", review: "Dengar semula, rakam semula, atau teruskan ke butiran hubungan.", mic: "Akses mikrofon diperlukan untuk merakam.", recordAgain: "Rakam semula",
    contactKicker: "Butiran hubungan", contactTitle: "Bagaimana pegawai boleh menghubungi anda?", contactNotice: "Nombor telefon dikumpulkan supaya Pegawai Perkhidmatan Sosial boleh menghubungi anda selepas menyemak kes.", phoneLabel: "Nombor telefon Singapura", phoneHelp: "Masukkan nombor 8 digit, dengan atau tanpa +65.", submit: "Hantar untuk semakan", back: "Kembali ke rakaman", invalidPhone: "Masukkan nombor telefon Singapura 8 digit yang sah.", sending: "Menghantar dengan selamat…", sendFail: "Rakaman tidak dapat dihantar.",
    doneTitle: "Rakaman diterima", doneMessage: "Pegawai boleh menyemaknya pada hari bekerja seterusnya. Jika keselamatan anda terancam sekarang, hubungi <strong>999</strong> atau <strong>1-767</strong>.", urgentTitle: "Sila dapatkan bantuan sekarang", urgentMessage: (resource) => `Rakaman anda telah diterima, tetapi mungkin menggambarkan risiko keselamatan segera. Hubungi <strong>${resource}</strong> sekarang dan jangan tunggu semakan hari berikutnya.`,
    emergency: 'Bahaya segera? Hubungi <a href="tel:999">999</a>. Krisis kesihatan mental? Hubungi <a href="tel:1767">1-767</a>.'
  },
  ta: {
    statusChecked: "சிங்கப்பூர் நேரம் சரிபார்க்கப்பட்டது", demoTime: "டெமோ நேரம் செயலில் உள்ளது", titleOpen: "நேரடி அதிகாரி இப்போது கிடைக்கிறார்", titleAnswered: "SilverArch பதிலளித்துள்ளது",
    openLead: "ComCare தொலைபேசி சேவை தினமும் காலை 7 மணி முதல் நள்ளிரவு வரை திறந்திருக்கும்.", closedLead: "நேரடி தொலைபேசி சேவை மூடப்பட்டுள்ளது. அடுத்த வேலை நாளில் பார்க்க குரல் பதிவை விடலாம்.",
    openMessage: "ComCare அதிகாரி இப்போது கிடைக்கிறார். தொலைபேசி சேவை திறந்திருக்கும் நேரத்தில் SilverArch பதிவு செய்யாது.", callHotline: "1800-222-0000 அழைக்கவும்",
    chooseKicker: "மொழியைத் தேர்வுசெய்க", chooseTitle: "எந்த மொழியில் தொடர விரும்புகிறீர்கள்?", playGreeting: "வணக்கத்தை ஒலிக்கவும்", playConsent: "ஒப்புதல் விளக்கத்தை ஒலிக்கவும்", playInstructions: "வழிமுறைகளை ஒலிக்கவும்",
    consentNotice: "<strong>இந்த சேனலில் நேரடி அதிகாரி இல்லை.</strong> உங்கள் பதிவு அடுத்த வேலை நாளில் பரிசீலிக்கப்படும். குரல் தொனி மற்றும் வேகம் முன்னுரிமை மதிப்பீட்டுக்கு உதவலாம்.",
    consentLabel: "ComCare intake க்காக என் குரல் பதிவு செய்யப்பட்டு உரையாக மாற்றப்படுவதற்கு நான் ஒப்புக்கொள்கிறேன்.", continue: "தொடரவும்",
    recordHeading: "முதலில் உங்களை அறிமுகப்படுத்தி, என்ன நடந்தது மற்றும் எந்த உதவி தேவை என்பதைச் சொல்லுங்கள்.",
    promptIntro: "அதிகாரி உங்கள் நிலையைப் புரிந்துகொள்ள, தயவுசெய்து குறிப்பிடுங்கள்:",
    promptItems: ["உங்கள் பெயர், வயது மற்றும் குடியுரிமை அல்லது வசிப்பு நிலை", "உங்கள் வேலை நிலை மற்றும் மாதாந்திர குடும்ப வருமானம்", "உங்களுடன் யார் வசிக்கிறார்கள், குழந்தைகளின் எண்ணிக்கை மற்றும் வயது", "வீடு, மருத்துவம், பராமரிப்பு, பள்ளி அல்லது பிற முக்கிய செலவுகள்", "சமீபத்தில் என்ன மாறியது மற்றும் இப்போது என்ன உதவி தேவை"],
    promptSmall: "NRIC கூற தேவையில்லை. இயல்பாக பேசுங்கள்; பகிர வசதியாக உள்ள விஷயங்களை மட்டும் பகிருங்கள்.",
    tapStart: "தொடங்க வட்டத்தைத் தட்டவும்.", recording: "பதிவு நடக்கிறது… முடிந்ததும் மீண்டும் தட்டவும்.", review: "மீண்டும் கேளுங்கள், மறுபதிவு செய்யுங்கள், அல்லது தொடர்பு விவரங்களுக்கு தொடருங்கள்.", mic: "பதிவு செய்ய மைக்ரோஃபோன் அனுமதி தேவை.", recordAgain: "மீண்டும் பதிவு",
    contactKicker: "தொடர்பு விவரங்கள்", contactTitle: "அதிகாரி உங்களை எப்படி தொடர்பு கொள்ளலாம்?", contactNotice: "உங்கள் வழக்கைப் பார்த்த பிறகு சமூக சேவை அதிகாரி தொடர்பு கொள்ள உங்கள் தொலைபேசி எண் சேகரிக்கப்படுகிறது.", phoneLabel: "சிங்கப்பூர் தொலைபேசி எண்", phoneHelp: "+65 உடன் அல்லது இல்லாமல் 8 இலக்க எண்ணை உள்ளிடுங்கள்.", submit: "பரிசீலனைக்கு அனுப்பு", back: "பதிவுக்கு திரும்பு", invalidPhone: "சரியான 8 இலக்க சிங்கப்பூர் தொலைபேசி எண்ணை உள்ளிடுங்கள்.", sending: "பாதுகாப்பாக அனுப்புகிறது…", sendFail: "பதிவை அனுப்ப முடியவில்லை.",
    doneTitle: "பதிவு பெறப்பட்டது", doneMessage: "அதிகாரி அடுத்த வேலை நாளில் இதைப் பார்க்கலாம். இப்போது பாதுகாப்பு ஆபத்து இருந்தால் <strong>999</strong> அல்லது <strong>1-767</strong> அழைக்கவும்.", urgentTitle: "இப்போது உதவி பெறுங்கள்", urgentMessage: (resource) => `உங்கள் பதிவு பெறப்பட்டது, ஆனால் உடனடி பாதுகாப்பு ஆபத்து இருக்கலாம். அடுத்த நாள் வரை காத்திருக்காமல் இப்போது <strong>${resource}</strong> தொடர்பு கொள்ளுங்கள்.`,
    emergency: 'உடனடி ஆபத்து? <a href="tel:999">999</a> அழைக்கவும். மனநலம் நெருக்கடி? <a href="tel:1767">1-767</a> அழைக்கவும்.'
  }
};

function copy() { return COPY[language] || COPY.en; }

function show(selector) {
  panels.forEach((item) => $(item).classList.toggle("hidden", item !== selector));
}

async function loadGate(demoHour = new URLSearchParams(location.search).get("demoHour")) {
  const suffix = demoHour === null || demoHour === "" ? "" : `?demoHour=${demoHour}`;
  gate = await fetch(`/api/time-gate${suffix}`).then((response) => response.json());
  renderCopy();
  show(gate.mode === "open" ? "#open-panel" : "#language-panel");
}

async function renderCopy() {
  const t = copy();
  document.documentElement.lang = language;
  $("#status-label").textContent = gate?.demoOverride ? t.demoTime : t.statusChecked;
  $("#title").textContent = gate?.mode === "open" ? t.titleOpen : t.titleAnswered;
  $("#message").textContent = gate?.mode === "open" ? t.openLead : t.closedLead;
  $("#open-message").textContent = t.openMessage; $("#open-call").textContent = t.callHotline;
  $("#language-kicker").textContent = t.chooseKicker; $("#language-title").textContent = t.chooseTitle;
  $("#play-greeting").textContent = t.playGreeting; $("#play-consent").textContent = t.playConsent; $("#play-recording-instructions").textContent = t.playInstructions;
  $("#consent-notice").innerHTML = t.consentNotice; $("#consent-label").textContent = t.consentLabel; $("#continue").textContent = t.continue;
  $("#record-heading").textContent = t.recordHeading; $("#prompt-intro").textContent = t.promptIntro; $("#prompt-list").innerHTML = t.promptItems.map((item) => `<li>${escapeHtml(item)}</li>`).join(""); $("#prompt-small").textContent = t.promptSmall;
  $("#record-again").textContent = t.recordAgain; $("#to-contact").textContent = t.continue; $("#record-status").textContent = recording ? t.review : t.tapStart;
  $("#contact-kicker").textContent = t.contactKicker; $("#contact-title").textContent = t.contactTitle; $("#contact-notice").textContent = t.contactNotice; $("#phone-label").textContent = t.phoneLabel; $("#phone-help").textContent = t.phoneHelp; $("#submit").textContent = t.submit; $("#back-to-recording").textContent = t.back;
  $("#done-title").textContent = t.doneTitle; $("#done-message").innerHTML = t.doneMessage; $("#emergency").innerHTML = t.emergency;
  await updatePromptAudio();
}

async function updatePromptAudio() {
  await Promise.all(PROMPTS.map(async (prompt) => {
    const button = $(`#play-${prompt}`);
    if (!button) return;
    const url = `/audio/prompts/${language}-${prompt}.mp3`;
    try {
      const response = await fetch(url, { method: "HEAD" });
      button.classList.toggle("hidden", !response.ok);
      button.dataset.audioUrl = response.ok ? url : "";
    } catch {
      button.classList.add("hidden");
      button.dataset.audioUrl = "";
    }
  }));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

document.querySelectorAll("[data-language]").forEach((button) => button.addEventListener("click", async () => {
  language = button.dataset.language;
  await renderCopy();
  show("#consent-panel");
}));

document.querySelectorAll(".prompt-audio").forEach((button) => button.addEventListener("click", () => {
  if (!button.dataset.audioUrl) return;
  promptAudio?.pause();
  promptAudio = new Audio(button.dataset.audioUrl);
  promptAudio.play();
}));

$("#consent").addEventListener("change", (event) => $("#continue").disabled = !event.target.checked);
$("#continue").addEventListener("click", () => show("#record-panel"));
$("#record").addEventListener("click", async () => {
  const t = copy();
  if (recorder?.state === "recording") {
    recorder.stop();
    clearInterval(timer);
    $("#record").classList.remove("active");
    recordingDurationMs = Date.now() - startedAt;
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => {
      recording = new Blob(chunks, { type: recorder.mimeType });
      stream.getTracks().forEach((track) => track.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(recording);
      $("#recording-preview").src = previewUrl;
      $("#recording-preview").classList.remove("hidden");
      $("#recording-actions").classList.remove("hidden");
      $("#record").classList.add("hidden");
      $("#record-status").textContent = t.review;
    };
    recorder.start();
    startedAt = Date.now();
    timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      $("#timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    }, 250);
    $("#record").classList.add("active");
    $("#record-status").textContent = t.recording;
  } catch {
    $("#record-status").textContent = t.mic;
  }
});

$("#record-again").addEventListener("click", () => {
  recording = null;
  $("#recording-preview").pause();
  $("#recording-preview").classList.add("hidden");
  $("#recording-actions").classList.add("hidden");
  $("#record").classList.remove("hidden");
  $("#timer").textContent = "00:00";
  $("#record-status").textContent = copy().tapStart;
});

$("#to-contact").addEventListener("click", () => show("#contact-panel"));
$("#back-to-recording").addEventListener("click", () => show("#record-panel"));

function normalizedPhone(value) {
  const compact = value.trim().replace(/[\s-]/g, "").replace(/^\+65/, "");
  return /^[3689]\d{7}$/.test(compact) ? `+65${compact}` : null;
}

$("#submit").addEventListener("click", async () => {
  const t = copy();
  const phone = normalizedPhone($("#phone").value);
  if (!phone) {
    $("#contact-status").textContent = t.invalidPhone;
    $("#phone").focus();
    return;
  }
  $("#submit").disabled = true;
  $("#contact-status").textContent = t.sending;
  const response = await fetch("/api/cases", {
    method: "POST",
    headers: { "content-type": recording.type, "x-contact-phone": phone, "x-audio-duration-ms": String(recordingDurationMs), "x-intake-language": language, "x-intake-mode": "web-call-simulator", ...(gate.demoOverride && { "x-demo-override": "after-hours" }) },
    body: recording
  });
  const body = await response.json();
  if (!response.ok) {
    $("#contact-status").textContent = body.error || t.sendFail;
    $("#submit").disabled = false;
    return;
  }
  if (body.urgency?.urgent) {
    $("#done-title").textContent = t.urgentTitle;
    $("#done-message").innerHTML = t.urgentMessage(body.urgency.resource);
  }
  show("#done-panel");
});

document.querySelectorAll("[data-hour]").forEach((button) => button.addEventListener("click", () => {
  const hour = button.dataset.hour;
  history.replaceState({}, "", hour ? `?demoHour=${hour}` : location.pathname);
  loadGate(hour);
}));

setTimeout(() => loadGate(), 650);
