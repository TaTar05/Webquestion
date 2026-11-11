const questions = [
  {
    title: "รายชื่อสินค้า/บริการทั้งหมดที่ต้องการโชว์ และแบ่งเป็นกี่หมวด",
    hint: "ระบุชื่อสินค้า บริการ และหมวดหมู่ที่ต้องการ"
  },
  {
    title: "สินค้าตัวไหนเป็นสินค้าหลักหรือขายดี ที่อยากให้ผู้เข้าชมเห็นก่อน",
    hint: "ช่วยบอกสินค้าหรือบริการเด่นที่อยากนำเสนอเป็นพิเศษ"
  },
  {
    title: "จะแสดงราคา หรือให้ติดต่อสอบถาม",
    hint: "ระบุได้ว่าต้องการแสดงราคา เริ่มต้น หรือให้สอบถามก่อน"
  },
  {
    title: "ผู้เข้าชมดูสินค้าแล้วต้องทำอะไรต่อ",
    hint: "เช่น โทร ส่งอีเมล ทัก LINE หรือกรอกฟอร์ม"
  },
  {
    title: "วิสัยทัศน์และพันธกิจเป็นอย่างไร",
    hint: "เล่าถึงเป้าหมายและแนวทางของธุรกิจ"
  },
  {
    title: "ใบรับรองหรือมาตรฐานที่มี",
    hint: "ระบุชื่อมาตรฐานหรือใบรับรองที่ต้องการแสดง"
  },
  {
    title: "ไฟล์ Logo ฉบับเต็ม",
    hint: "แนบไฟล์ PNG, JPG, WEBP, SVG หรือ PDF ขนาดไม่เกิน 7 MB",
    upload: true
  },
  {
    title: "ธีมของเว็บและสีหลักที่ต้องการ",
    hint: "เช่น เรียบหรู สดใส มินิมอล พร้อมระบุโทนสี"
  },
  {
    title: "ข่าวสารและกิจกรรมต่าง ๆ ที่ต้องการนำเสนอ",
    hint: "แจ้งหัวข้อข่าว กิจกรรม หรือข้อมูลที่อยากให้มีบนเว็บ"
  },
  {
    title: "สิ่งอื่น ๆ ที่ควรรู้เพิ่มเติม",
    hint: "ข้อกำหนด ความชอบ หรือตัวอย่างเว็บไซต์ที่ชอบ"
  }
];

const questionsContainer = document.querySelector("#questions");
const form = document.querySelector("#questionnaire-form");
const statusMessage = document.querySelector("#form-status");
const submitButton = document.querySelector("#submit-button");
const logoInputId = "answer-6";

questionsContainer.innerHTML = questions.map((question, index) => {
  const number = index + 1;
  const wideClass = question.upload || number === 10 ? " wide" : "";
  const answerField = question.upload
    ? `<label class="upload-box" for="${logoInputId}">
        <span class="upload-icon" aria-hidden="true">↑</span>
        <span class="upload-copy">
          <strong id="logo-file-name">คลิกเพื่อเลือกไฟล์ Logo</strong>
          <small>${question.hint}</small>
        </span>
        <input id="${logoInputId}" name="logo" type="file" accept=".png,.jpg,.jpeg,.webp,.svg,.pdf,image/png,image/jpeg,image/webp,image/svg+xml,application/pdf">
      </label>`
    : `<textarea id="answer-${number}" name="answer-${number}" maxlength="5000" placeholder="พิมพ์คำตอบของคุณที่นี่..." required></textarea>`;

  return `<section class="question-card${wideClass}">
    <div class="question-topline">
      <span class="question-number">${String(number).padStart(2, "0")}</span>
      <div class="question-copy">
        <label class="question-label" for="${question.upload ? logoInputId : `answer-${number}`}">${question.title}<span class="required-note"> *</span></label>
        <p class="question-hint">${question.hint}</p>
      </div>
    </div>
    ${answerField}
  </section>`;
}).join("");

document.querySelector(`#${logoInputId}`).addEventListener("change", (event) => {
  const [file] = event.target.files;
  document.querySelector("#logo-file-name").textContent = file
    ? `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`
    : "คลิกเพื่อเลือกไฟล์ Logo";
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("อ่านไฟล์ Logo ไม่สำเร็จ กรุณาเลือกไฟล์อีกครั้ง"));
    reader.readAsDataURL(file);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusMessage.textContent = "";
  statusMessage.className = "form-status";

  const logoFile = document.querySelector(`#${logoInputId}`).files[0];
  if (logoFile && logoFile.size > 7 * 1024 * 1024) {
    statusMessage.textContent = "ไฟล์ Logo ต้องมีขนาดไม่เกิน 7 MB";
    statusMessage.classList.add("error");
    return;
  }

  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "กำลังส่ง...";

  try {
    const logo = logoFile
      ? {
          name: logoFile.name,
          type: logoFile.type,
          data: await readFileAsDataUrl(logoFile)
        }
      : null;
    const answers = questions.map((question, index) =>
      question.upload ? "" : document.querySelector(`#answer-${index + 1}`).value
    );
    const response = await fetch("/api/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.querySelector("#respondent-name").value,
        contact: document.querySelector("#respondent-contact").value,
        answers,
        logo,
        website: ""
      })
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "ส่งคำตอบไม่สำเร็จ กรุณาลองใหม่");
    }

    statusMessage.textContent = result.message;
    statusMessage.classList.add("success");
    form.reset();
    document.querySelector("#logo-file-name").textContent = "คลิกเพื่อเลือกไฟล์ Logo";
  } catch (error) {
    statusMessage.textContent = error.message || "เกิดข้อผิดพลาดในการส่งคำตอบ กรุณาลองใหม่";
    statusMessage.classList.add("error");
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "ส่งคำตอบ";
  }
});
