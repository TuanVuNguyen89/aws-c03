const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");

function extractBalancedJson(text, openBraceIndex) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openBraceIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(openBraceIndex, i + 1);
    }
  }
  throw new Error("Could not find balanced end of quizData JSON");
}

function loadQuizFile(filePath) {
  const html = fs.readFileSync(filePath, "utf8");
  const marker = "const quizData = ";
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) throw new Error(`quizData not found in ${filePath}`);
  const openBrace = html.indexOf("{", markerIdx);
  const jsonStr = extractBalancedJson(html, openBrace);
  const data = JSON.parse(jsonStr);
  return { html, data };
}

function slugify(filename) {
  const m = filename.match(/Quiz\s*(\d+)/i);
  const n = m ? parseInt(m[1], 10) : null;
  return { key: n ? `quiz-${n}` : filename.replace(/\.html$/i, ""), num: n };
}

function loadAllQuizzes() {
  const files = fs
    .readdirSync(ROOT_DIR)
    .filter((f) => /^Quiz\s*\d+.*\.html$/i.test(f));

  const registry = files.map((file) => {
    const { key, num } = slugify(file);
    const filePath = path.join(ROOT_DIR, file);
    const { html, data } = loadQuizFile(filePath);

    const questionsById = new Map();
    (data.questions || []).forEach((q) => {
      const prompt = q.prompt || {};
      questionsById.set(String(q.id), {
        id: q.id,
        question: prompt.question || "",
        answers: prompt.answers || [],
        explanation: prompt.explanation || "",
        correct: (q.correct_response || []).map((r) => r.toLowerCase()),
      });
    });

    return {
      key,
      num: num || 0,
      file,
      title: data.quiz_title || file,
      totalQuestions: (data.questions || []).length,
      passPercent: data.pass_percent || null,
      duration: data.duration || null,
      rawHtml: html,
      questionsById,
    };
  });

  registry.sort((a, b) => a.num - b.num);
  return registry;
}

let REGISTRY = loadAllQuizzes();
const BY_KEY = new Map(REGISTRY.map((q) => [q.key, q]));

function getQuizList() {
  return REGISTRY.map(({ key, num, title, totalQuestions, passPercent, duration }) => ({
    key, num, title, totalQuestions, passPercent, duration,
  }));
}

function getQuiz(key) {
  return BY_KEY.get(key);
}

function buildInjectedScript(quiz) {
  const allTests = REGISTRY.map((q) => ({
    title: q.title,
    index: q.num,
    section: "",
    fileName: `/quiz/${q.key}`,
  }));

  return `
  <script>
    quizData.allTests = ${JSON.stringify(allTests)};
    quizData.currentIndex = ${quiz.num};
    quizData.currentSection = "";

    (function () {
      var __startedAt = Date.now();
      var __mode = "practice";
      var __posted = false;

      var __origBegin = beginQuiz;
      beginQuiz = function (mode) {
        __startedAt = Date.now();
        __mode = mode;
        __posted = false;
        return __origBegin(mode);
      };

      var __origFinish = finishTestInternal;
      finishTestInternal = function (dest) {
        var result = __origFinish(dest);
        if (__posted) return result;
        __posted = true;

        var answers = [];
        try {
          questions.forEach(function (q, i) {
            var card = document.getElementById("question-" + i);
            if (!card) return;
            var correct = JSON.parse(card.dataset.correctAnswers || "[]");
            var selected = Array.from(card.querySelectorAll(".option.selected")).map(function (o) { return o.dataset.letter; });
            var status = selected.length === 0 ? "skipped" : (
              (card.dataset.isMultiAnswer === "true"
                ? (correct.every(function (l) { return selected.includes(l); }) && selected.every(function (l) { return correct.includes(l); }))
                : (selected.length === 1 && correct.includes(selected[0])))
                ? "correct" : "incorrect"
            );
            answers.push({ questionId: card.dataset.questionId, selected: selected, correct: correct, status: status });
          });
        } catch (e) { /* best-effort */ }

        var correctCount = parseInt(document.getElementById("correct-count").textContent, 10) || 0;
        var wrongCount = parseInt(document.getElementById("wrong-count").textContent, 10) || 0;
        var skippedCount = parseInt(document.getElementById("skipped-count").textContent, 10) || 0;
        var percent = parseInt((document.getElementById("score-percent").textContent || "0").replace("%", ""), 10) || 0;
        var durationSeconds = Math.max(0, Math.round((Date.now() - __startedAt) / 1000));
        var passPercent = quizData.pass_percent || null;

        fetch("/api/attempts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quizKey: "${quiz.key}",
            quizTitle: "Practice Test ${quiz.num}: ${quiz.title.replace(/"/g, '\\"')}",
            mode: __mode,
            totalQuestions: totalQuestions,
            correct: correctCount,
            wrong: wrongCount,
            skipped: skippedCount,
            percent: percent,
            passPercent: passPercent,
            durationSeconds: durationSeconds,
            answers: answers,
          }),
        }).catch(function () { /* ignore network errors, attempt still shown locally */ });

        return result;
      };
    })();
  </script>
  <a href="/dashboard" class="__back-to-dashboard" title="Back to dashboard"><i class="fas fa-arrow-left"></i> Dashboard</a>
  <style>
    .__back-to-dashboard {
      position: fixed; top: 14px; left: 14px; z-index: 10000;
      background: #2c3e50; color: #fff; text-decoration: none;
      padding: 8px 14px; border-radius: 6px; font: 600 13px "Segoe UI", Arial, sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,.2);
    }
    .__back-to-dashboard:hover { background: #1a252f; }
  </style>
  `;
}

function renderQuizPage(key) {
  const quiz = getQuiz(key);
  if (!quiz) return null;

  let html = quiz.rawHtml.split("images/").join("/images/");
  const inject = buildInjectedScript(quiz);
  html = html.replace("</body>", `${inject}\n</body>`);
  return html;
}

function reload() {
  REGISTRY = loadAllQuizzes();
  BY_KEY.clear();
  REGISTRY.forEach((q) => BY_KEY.set(q.key, q));
}

module.exports = { getQuizList, getQuiz, renderQuizPage, reload };
