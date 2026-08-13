const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const db = require("./lib/db");
const quizzes = require("./lib/quizzes");
const render = require("./lib/render");

const PORT = process.env.PORT || 3000;
const COOKIE_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const COOKIE_NAME = "uid";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(COOKIE_SECRET));

app.use("/images", express.static(path.join(__dirname, "images")));
app.use(express.static(path.join(__dirname, "public")));

function loadUser(req, res, next) {
  const uid = req.signedCookies[COOKIE_NAME];
  req.user = uid ? db.findUserById(Number(uid)) : null;
  next();
}
app.use(loadUser);

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect("/");
  next();
}

// --- Auth ---
app.get("/", (req, res) => {
  if (req.user) return res.redirect("/dashboard");
  res.send(render.loginPage());
});

app.post("/api/login", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name || name.length > 60) {
    return res.status(400).send(render.loginPage({ error: "Please enter a valid name (1-60 characters)." }));
  }
  const user = db.getOrCreateUser(name);
  res.cookie(COOKIE_NAME, String(user.id), {
    signed: true,
    httpOnly: true,
    maxAge: ONE_YEAR_MS,
    sameSite: "lax",
  });
  res.redirect("/dashboard");
});

app.post("/api/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// --- Dashboard ---
app.get("/dashboard", requireAuth, (req, res) => {
  const list = quizzes.getQuizList();
  const bestScores = db.bestScoresForUser(req.user.id);
  res.send(render.dashboardPage({ user: req.user, quizzes: list, bestScores }));
});

// --- Quiz taking ---
app.get("/quiz/:key", requireAuth, (req, res) => {
  const html = quizzes.renderQuizPage(req.params.key);
  if (!html) return res.status(404).send("Quiz not found");
  res.send(html);
});

// --- Attempts / history ---
app.post("/api/attempts", requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.quizKey || typeof b.totalQuestions !== "number") {
    return res.status(400).json({ error: "Invalid attempt payload" });
  }
  const passPercent = typeof b.passPercent === "number" ? b.passPercent : null;
  const passed = passPercent != null ? (b.percent >= passPercent ? 1 : 0) : null;

  const id = db.insertAttempt({
    user_id: req.user.id,
    quiz_key: String(b.quizKey),
    quiz_title: String(b.quizTitle || b.quizKey),
    mode: String(b.mode || "practice"),
    total_questions: b.totalQuestions | 0,
    correct_count: b.correct | 0,
    wrong_count: b.wrong | 0,
    skipped_count: b.skipped | 0,
    score_percent: b.percent | 0,
    pass_percent: passPercent,
    passed,
    duration_seconds: typeof b.durationSeconds === "number" ? b.durationSeconds : null,
    started_at: null,
    answers_json: JSON.stringify(b.answers || []),
  });
  res.json({ ok: true, id });
});

app.get("/history", requireAuth, (req, res) => {
  const attempts = db.listAttemptsForUser(req.user.id);
  res.send(render.historyPage({ user: req.user, attempts }));
});

app.get("/history/:id", requireAuth, (req, res) => {
  const attempt = db.getAttemptById(Number(req.params.id));
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).send("Attempt not found");
  const quiz = quizzes.getQuiz(attempt.quiz_key);
  res.send(render.attemptDetailPage({ user: req.user, attempt, quiz }));
});

app.listen(PORT, () => {
  console.log(`AWS SAA Practice Portal listening on http://localhost:${PORT}`);
});
