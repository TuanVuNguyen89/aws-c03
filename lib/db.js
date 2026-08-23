const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name COLLATE NOCASE)
  );

  CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quiz_key TEXT NOT NULL,
    quiz_title TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'practice',
    total_questions INTEGER NOT NULL,
    correct_count INTEGER NOT NULL,
    wrong_count INTEGER NOT NULL,
    skipped_count INTEGER NOT NULL,
    score_percent INTEGER NOT NULL,
    pass_percent INTEGER,
    passed INTEGER,
    duration_seconds INTEGER,
    started_at TEXT,
    finished_at TEXT NOT NULL DEFAULT (datetime('now')),
    answers_json TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, finished_at DESC);

  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quiz_key TEXT NOT NULL,
    mode TEXT NOT NULL,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, quiz_key, mode)
  );
`);

function findUserByName(name) {
  return db.prepare("SELECT * FROM users WHERE name = ? COLLATE NOCASE").get(name);
}

function findUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function createUser(name) {
  const info = db.prepare("INSERT INTO users (name) VALUES (?)").run(name);
  return findUserById(info.lastInsertRowid);
}

function getOrCreateUser(name) {
  return findUserByName(name) || createUser(name);
}

function insertAttempt(attempt) {
  const info = db.prepare(`
    INSERT INTO attempts (
      user_id, quiz_key, quiz_title, mode, total_questions, correct_count,
      wrong_count, skipped_count, score_percent, pass_percent, passed,
      duration_seconds, started_at, answers_json
    ) VALUES (
      @user_id, @quiz_key, @quiz_title, @mode, @total_questions, @correct_count,
      @wrong_count, @skipped_count, @score_percent, @pass_percent, @passed,
      @duration_seconds, @started_at, @answers_json
    )
  `).run(attempt);
  return info.lastInsertRowid;
}

function getAttemptById(id) {
  return db.prepare("SELECT * FROM attempts WHERE id = ?").get(id);
}

function listAttemptsForUser(userId, limit = 200) {
  return db.prepare(
    "SELECT * FROM attempts WHERE user_id = ? ORDER BY finished_at DESC, id DESC LIMIT ?"
  ).all(userId, limit);
}

function bestScoresForUser(userId) {
  const rows = db.prepare(`
    SELECT quiz_key, MAX(score_percent) AS best_percent, COUNT(*) AS attempts
    FROM attempts WHERE user_id = ? GROUP BY quiz_key
  `).all(userId);
  const map = {};
  rows.forEach((r) => { map[r.quiz_key] = r; });
  return map;
}

// --- In-flight quiz progress (pause / resume) ---

function saveProgress(userId, quizKey, mode, state) {
  db.prepare(`
    INSERT INTO progress (user_id, quiz_key, mode, state_json, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, quiz_key, mode)
    DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
  `).run(userId, quizKey, mode, JSON.stringify(state));
}

function getProgress(userId, quizKey, mode) {
  const row = db
    .prepare("SELECT state_json, updated_at FROM progress WHERE user_id = ? AND quiz_key = ? AND mode = ?")
    .get(userId, quizKey, mode);
  if (!row) return null;
  try {
    const state = JSON.parse(row.state_json);
    state.updatedAt = row.updated_at;
    return state;
  } catch (e) {
    return null;
  }
}

function deleteProgress(userId, quizKey, mode) {
  if (mode) {
    db.prepare("DELETE FROM progress WHERE user_id = ? AND quiz_key = ? AND mode = ?").run(userId, quizKey, mode);
  } else {
    db.prepare("DELETE FROM progress WHERE user_id = ? AND quiz_key = ?").run(userId, quizKey);
  }
}

// Compact summary per quiz for the dashboard: { "quiz-1": [{ mode, answered, total, updated_at }] }
function progressSummaryForUser(userId) {
  const rows = db
    .prepare("SELECT quiz_key, mode, state_json, updated_at FROM progress WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId);
  const map = {};
  rows.forEach((r) => {
    let answered = 0;
    let total = 0;
    try {
      const st = JSON.parse(r.state_json);
      total = (st.order || []).length;
      answered = (st.selections || []).filter((sel) => sel && sel.length > 0).length;
    } catch (e) { /* keep zeros */ }
    (map[r.quiz_key] = map[r.quiz_key] || []).push({
      mode: r.mode, answered, total, updated_at: r.updated_at,
    });
  });
  return map;
}

module.exports = {
  db,
  saveProgress,
  getProgress,
  deleteProgress,
  progressSummaryForUser,
  getOrCreateUser,
  findUserById,
  insertAttempt,
  getAttemptById,
  listAttemptsForUser,
  bestScoresForUser,
};
