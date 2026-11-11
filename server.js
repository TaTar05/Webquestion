require("dotenv").config();

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const nodemailer = require("nodemailer");

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_LOGO_BYTES = 7 * 1024 * 1024;
const PUBLIC_DIR = path.join(__dirname, "public");
const QUESTIONS = [
  "รายชื่อสินค้า/บริการทั้งหมดที่ต้องการโชว์ และแบ่งเป็นกี่หมวด",
  "สินค้าตัวไหนเป็นสินค้าหลักหรือขายดี ที่อยากให้ผู้เข้าชมเห็นก่อน",
  "จะแสดงราคา หรือให้ติดต่อสอบถาม",
  "ผู้เข้าชมดูสินค้าแล้วต้องทำอะไรต่อ เช่น โทร ส่งอีเมล ทัก LINE หรือกรอกฟอร์ม",
  "วิสัยทัศน์และพันธกิจเป็นอย่างไร",
  "ใบรับรองหรือมาตรฐานที่มี",
  "ไฟล์ Logo ฉบับเต็ม",
  "ธีมของเว็บและสีหลักที่ต้องการ",
  "ข่าวสารและกิจกรรมต่าง ๆ ที่ต้องการนำเสนอ",
  "สิ่งอื่น ๆ ที่ควรรู้เพิ่มเติม"
];
const ALLOWED_LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "application/pdf"
]);
const requestCounts = new Map();

function getTransporter() {
  const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "RECIPIENT_EMAIL"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];

    request.on("data", (chunk) => {
      if (settled) {
        return;
      }
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(Object.assign(new Error("Request body is too large"), { status: 413 }));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });

    request.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function checkRateLimit(request) {
  const now = Date.now();
  const ip = request.socket.remoteAddress || "unknown";
  const previous = requestCounts.get(ip);
  const windowMs = 15 * 60 * 1000;

  if (!previous || now - previous.startedAt >= windowMs) {
    requestCounts.set(ip, { startedAt: now, count: 1 });
    return true;
  }

  previous.count += 1;
  return previous.count <= 5;
}

function validateSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "ข้อมูลที่ส่งมาไม่ถูกต้อง";
  }
  if (typeof body.website === "string" && body.website.trim()) {
    return "ส่งแบบฟอร์มไม่สำเร็จ";
  }
  if (!Array.isArray(body.answers) || body.answers.length !== QUESTIONS.length) {
    return "กรุณากรอกคำตอบให้ครบทุกข้อ";
  }
  if (body.answers.some((answer) => typeof answer !== "string" || answer.length > 5000)) {
    return "คำตอบต้องเป็นข้อความและมีความยาวไม่เกิน 5,000 ตัวอักษรต่อข้อ";
  }
  if (typeof body.name !== "string" || body.name.trim().length > 120) {
    return "กรุณาตรวจสอบชื่อผู้ตอบ";
  }
  if (typeof body.contact !== "string" || body.contact.length > 200) {
    return "กรุณาตรวจสอบข้อมูลติดต่อ";
  }
  if (body.logo !== null && body.logo !== undefined) {
    const logo = body.logo;
    if (
      typeof logo !== "object" ||
      typeof logo.name !== "string" ||
      typeof logo.type !== "string" ||
      typeof logo.data !== "string" ||
      !ALLOWED_LOGO_TYPES.has(logo.type)
    ) {
      return "ชนิดไฟล์ Logo ไม่รองรับ กรุณาใช้ PNG, JPG, WEBP, SVG หรือ PDF";
    }
    const base64 = logo.data.replace(/^data:[^;]+;base64,/, "");
    const estimatedBytes = Math.floor((base64.length * 3) / 4);
    if (estimatedBytes > MAX_LOGO_BYTES || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      return "ไฟล์ Logo ต้องมีขนาดไม่เกิน 7 MB";
    }
  }
  return null;
}

async function handleSubmission(request, response) {
  if (!checkRateLimit(request)) {
    sendJson(response, 429, { message: "ส่งคำตอบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" });
    return;
  }

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    sendJson(response, error.status || 400, { message: error.message });
    return;
  }

  const validationError = validateSubmission(body);
  if (validationError) {
    sendJson(response, 400, { message: validationError });
    return;
  }

  const answersHtml = QUESTIONS.map((question, index) => {
    const answer = body.answers[index].trim() || "ไม่ได้ระบุ";
    return `<h3>${index + 1}. ${escapeHtml(question)}</h3><p>${escapeHtml(answer).replaceAll("\n", "<br>")}</p>`;
  }).join("");
  const textAnswers = QUESTIONS.map((question, index) =>
    `${index + 1}. ${question}\n${body.answers[index].trim() || "ไม่ได้ระบุ"}`
  ).join("\n\n");
  const attachments = [];

  if (body.logo) {
    const base64 = body.logo.data.replace(/^data:[^;]+;base64,/, "");
    attachments.push({
      filename: path.basename(body.logo.name).slice(0, 120) || "logo",
      content: Buffer.from(base64, "base64"),
      contentType: body.logo.type
    });
  }

  const contactText = `ชื่อผู้ตอบ: ${body.name.trim() || "ไม่ได้ระบุ"}\nข้อมูลติดต่อ: ${body.contact.trim() || "ไม่ได้ระบุ"}`;
  const transporter = getTransporter();

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.RECIPIENT_EMAIL,
    subject: "มีคำตอบแบบสอบถามจัดทำเว็บไซต์ใหม่",
    text: `${contactText}\n\n${textAnswers}`,
    html: `<p><strong>ชื่อผู้ตอบ:</strong> ${escapeHtml(body.name.trim() || "ไม่ได้ระบุ")}<br><strong>ข้อมูลติดต่อ:</strong> ${escapeHtml(body.contact.trim() || "ไม่ได้ระบุ")}</p>${answersHtml}`,
    attachments
  });

  sendJson(response, 200, { message: "ส่งคำตอบเรียบร้อยแล้ว ขอบคุณมากครับ" });
}

function serveStatic(request, response) {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);

  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    sendJson(response, 404, { message: "ไม่พบหน้าที่ต้องการ" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, 404, { message: "ไม่พบหน้าที่ต้องการ" });
      return;
    }

    const contentTypes = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    };
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/responses") {
    try {
      await handleSubmission(request, response);
    } catch (error) {
      console.error("Email delivery failed:", error.message);
      if (!response.headersSent) {
        sendJson(response, 500, { message: "ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่ภายหลัง" });
      }
    }
    return;
  }

  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }

  sendJson(response, 405, { message: "ไม่รองรับวิธีการเรียกนี้" });
});

server.listen(PORT, () => {
  console.log(`Questionnaire app is running at http://localhost:${PORT}`);
});
