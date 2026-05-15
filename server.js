const express = require("express");
const ExcelJS = require("exceljs");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || 3000);
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const dataRoot = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const dataDir = dataRoot;
const exportDir = path.join(dataRoot, "exports");
const dataFile = path.join(dataDir, "surveys.json");

const db = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }
    })
  : null;

app.use(express.json({ limit: "1mb" }));

function ensureDirectories() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(exportDir, { recursive: true });

  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, "[]", "utf8");
  }
}

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const interfaceName of Object.keys(interfaces)) {
    for (const network of interfaces[interfaceName] || []) {
      if (network.family === "IPv4" && !network.internal) {
        candidates.push(network.address);
      }
    }
  }

  for (const address of candidates) {
    if (
      address.startsWith("192.168.") ||
      address.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
    ) {
      return address;
    }
  }

  if (candidates.length) {
    return candidates[0];
  }

  return "localhost";
}

function createDashboard(records) {
  const satisfactionCounts = {
    "非常满意": 0,
    "满意": 0,
    "一般": 0,
    "不满意": 0,
    "非常不满意": 0
  };

  const frequencyCounts = {
    "每天": 0,
    "每周": 0,
    "每月": 0,
    "偶尔": 0
  };

  const advantagesCounts = {
    "生活质量": 0,
    "服务态度": 0,
    "响应速度": 0,
    "性价比": 0,
    "晚年保障": 0
  };

  let totalScore = 0;

  for (const record of records) {
    if (satisfactionCounts[record.satisfaction] !== undefined) {
      satisfactionCounts[record.satisfaction] += 1;
    }

    if (frequencyCounts[record.frequency] !== undefined) {
      frequencyCounts[record.frequency] += 1;
    }

    for (const item of record.advantages || []) {
      if (advantagesCounts[item] !== undefined) {
        advantagesCounts[item] += 1;
      }
    }

    totalScore += Number(record.teacherScore || 0);
  }

  return {
    totalCount: records.length,
    averageTeacherScore: records.length ? totalScore / records.length : 0,
    latestSubmission: records.length ? records[0].submittedAt : null,
    satisfactionCounts,
    frequencyCounts,
    advantagesCounts,
    records
  };
}

function validateSurvey(body) {
  const advantages = Array.isArray(body.advantages) ? body.advantages.filter(Boolean) : [];
  const teacherScore = Number(body.teacherScore);

  if (!body.satisfaction) {
    return "请选择整体满意度。";
  }

  if (!body.frequency) {
    return "请选择使用频率。";
  }

  if (!advantages.length) {
    return "请至少选择一个教师职业优势。";
  }

  if (!Number.isFinite(teacherScore) || teacherScore < 1 || teacherScore > 10) {
    return "请填写 1 到 10 分的意愿评分。";
  }

  return null;
}

function getPublicBaseUrl(req) {
  const explicitUrl = String(process.env.PUBLIC_BASE_URL || "").trim();

  if (explicitUrl) {
    return explicitUrl.replace(/\/$/, "");
  }

  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = forwardedProto ? forwardedProto.split(",")[0] : req.protocol;
  return `${protocol}://${req.get("host")}`;
}

function isAdminAuthEnabled() {
  return Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD);
}

function unauthorized(res) {
  res.set("WWW-Authenticate", 'Basic realm="Survey Admin"');
  res.status(401).send("需要管理员账号密码。");
}

function requireAdminAuth(req, res, next) {
  if (!isAdminAuthEnabled()) {
    next();
    return;
  }

  const header = req.get("authorization");

  if (!header || !header.startsWith("Basic ")) {
    unauthorized(res);
    return;
  }

  const encoded = header.slice(6);
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");

  if (separatorIndex === -1) {
    unauthorized(res);
    return;
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  if (
    username !== process.env.ADMIN_USERNAME ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    unauthorized(res);
    return;
  }

  next();
}

function normalizeRecord(record) {
  return {
    id: String(record.id),
    name: String(record.name || "").trim(),
    contact: String(record.contact || "").trim(),
    satisfaction: String(record.satisfaction || "").trim(),
    teacherScore: Number(record.teacherScore),
    advantages: Array.isArray(record.advantages)
      ? record.advantages.map((item) => String(item).trim()).filter(Boolean)
      : [],
    frequency: String(record.frequency || "").trim(),
    suggestion: String(record.suggestion || "").trim(),
    submittedAt: record.submittedAt || new Date().toISOString()
  };
}

function readSurveysFromFile() {
  ensureDirectories();

  try {
    const raw = fs.readFileSync(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeRecord) : [];
  } catch (error) {
    return [];
  }
}

function saveSurveysToFile(records) {
  ensureDirectories();
  fs.writeFileSync(dataFile, JSON.stringify(records, null, 2), "utf8");
}

async function initDatabase() {
  if (!db) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS surveys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      satisfaction TEXT NOT NULL,
      teacher_score INTEGER NOT NULL,
      advantages JSONB NOT NULL DEFAULT '[]'::jsonb,
      frequency TEXT NOT NULL,
      suggestion TEXT NOT NULL DEFAULT '',
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listSurveys() {
  if (!db) {
    return readSurveysFromFile();
  }

  const result = await db.query(`
    SELECT
      id,
      name,
      contact,
      satisfaction,
      teacher_score AS "teacherScore",
      advantages,
      frequency,
      suggestion,
      submitted_at AS "submittedAt"
    FROM surveys
    ORDER BY submitted_at DESC
  `);

  return result.rows.map((row) =>
    normalizeRecord({
      ...row,
      advantages: Array.isArray(row.advantages) ? row.advantages : []
    })
  );
}

async function insertSurvey(record) {
  const normalized = normalizeRecord(record);

  if (!db) {
    const surveys = readSurveysFromFile();
    surveys.unshift(normalized);
    saveSurveysToFile(surveys);
    return normalized;
  }

  await db.query(
    `
      INSERT INTO surveys (
        id,
        name,
        contact,
        satisfaction,
        teacher_score,
        advantages,
        frequency,
        suggestion,
        submitted_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
    `,
    [
      normalized.id,
      normalized.name,
      normalized.contact,
      normalized.satisfaction,
      normalized.teacherScore,
      JSON.stringify(normalized.advantages),
      normalized.frequency,
      normalized.suggestion,
      normalized.submittedAt
    ]
  );

  return normalized;
}

app.get("/admin", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/admin.html", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/share", async (req, res) => {
  try {
    const shareUrl = `${getPublicBaseUrl(req)}/`;
    const qrCodeDataUrl = await QRCode.toDataURL(shareUrl, {
      width: 320,
      margin: 1,
      color: {
        dark: "#14323a",
        light: "#ffffff"
      }
    });

    res.json({
      shareUrl,
      adminUrl: `${getPublicBaseUrl(req)}/admin`,
      qrCodeDataUrl
    });
  } catch (error) {
    res.status(500).json({ message: "生成二维码失败。" });
  }
});

app.post("/api/surveys", async (req, res) => {
  try {
    const errorMessage = validateSurvey(req.body);

    if (errorMessage) {
      res.status(400).json({ message: errorMessage });
      return;
    }

    const record = await insertSurvey({
      id: String(Date.now()),
      name: req.body.name,
      contact: req.body.contact,
      satisfaction: req.body.satisfaction,
      teacherScore: req.body.teacherScore,
      advantages: req.body.advantages,
      frequency: req.body.frequency,
      suggestion: req.body.suggestion,
      submittedAt: new Date().toISOString()
    });

    res.status(201).json({
      message: "提交成功",
      record
    });
  } catch (error) {
    console.error("Failed to save survey", error);
    res.status(500).json({ message: "保存问卷失败，请稍后重试。" });
  }
});

app.get("/api/dashboard", requireAdminAuth, async (req, res) => {
  try {
    const surveys = await listSurveys();
    res.json(createDashboard(surveys));
  } catch (error) {
    console.error("Failed to load dashboard", error);
    res.status(500).json({ message: "加载后台数据失败。" });
  }
});

app.get("/api/export/excel", requireAdminAuth, async (req, res) => {
  try {
    const surveys = await listSurveys();
    ensureDirectories();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("教师满意度调查");

    worksheet.columns = [
      { header: "提交时间", key: "submittedAt", width: 24 },
      { header: "姓名", key: "name", width: 16 },
      { header: "联系方式", key: "contact", width: 22 },
      { header: "整体满意度", key: "satisfaction", width: 16 },
      { header: "做老师意愿评分", key: "teacherScore", width: 16 },
      { header: "最看重优势", key: "advantages", width: 36 },
      { header: "使用频率", key: "frequency", width: 14 },
      { header: "建议或意见", key: "suggestion", width: 48 }
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "DFF6F7" }
    };

    for (const survey of surveys) {
      worksheet.addRow({
        submittedAt: survey.submittedAt ? new Date(survey.submittedAt).toLocaleString("zh-CN") : "",
        name: survey.name || "",
        contact: survey.contact || "",
        satisfaction: survey.satisfaction || "",
        teacherScore: survey.teacherScore || "",
        advantages: Array.isArray(survey.advantages) ? survey.advantages.join("、") : "",
        frequency: survey.frequency || "",
        suggestion: survey.suggestion || ""
      });
    }

    worksheet.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });

    const fileName = `teacher-survey-${Date.now()}.xlsx`;
    const filePath = path.join(exportDir, fileName);
    await workbook.xlsx.writeFile(filePath);

    res.download(filePath, fileName);
  } catch (error) {
    console.error("Failed to export excel", error);
    res.status(500).json({ message: "导出 Excel 失败。" });
  }
});

async function start() {
  ensureDirectories();
  await initDatabase();

  app.listen(port, () => {
    const localIp = getLocalIpAddress();
    console.log(`Survey app is running at http://localhost:${port}`);
    console.log(`LAN share URL: http://${localIp}:${port}`);
    console.log(db ? "Storage mode: PostgreSQL" : "Storage mode: local JSON");

    if (process.env.PUBLIC_BASE_URL) {
      console.log(`Public share URL: ${process.env.PUBLIC_BASE_URL}`);
    }
  });
}

start().catch((error) => {
  console.error("Failed to start application", error);
  process.exit(1);
});
