import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// ── 미들웨어 ──
app.use(helmet());
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(morgan("dev"));
app.use(express.json({ limit: "5mb" }));

// ── 헬스체크 ──
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "sequin-api",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ── 임시 루트 ──
app.get("/", (_req, res) => {
  res.json({ message: "Sequin API" });
});

// ── 서버 시작 ──
app.listen(PORT, () => {
  console.log(`⚡ Sequin API running on http://localhost:${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
});
