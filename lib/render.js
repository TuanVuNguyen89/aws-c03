function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "");
}

function layout({ title, user, active, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  ${user ? `
  <div class="topnav">
    <a class="brand" href="/dashboard"><i class="fas fa-cloud"></i> AWS SAA Practice Portal</a>
    <nav>
      <a href="/dashboard" style="${active === "dashboard" ? "color:var(--accent)" : ""}">Quizzes</a>
      <a href="/history" style="${active === "history" ? "color:var(--accent)" : ""}">History</a>
      <span class="user-info">Hi, ${escapeHtml(user.name)}</span>
      <a href="#" onclick="fetch('/api/logout',{method:'POST'}).then(()=>location.href='/')">Logout</a>
    </nav>
  </div>` : ""}
  ${body}
</body>
</html>`;
}

function loginPage({ error } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign in — AWS SAA Practice Portal</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <div class="login-wrap">
    <div class="login-card">
      <h1><i class="fas fa-cloud"></i> AWS SAA Practice Portal</h1>
      <p class="subtitle">Enter your name to start practicing</p>
      ${error ? `<div class="error-msg">${escapeHtml(error)}</div>` : ""}
      <form method="POST" action="/api/login">
        <input type="text" name="name" placeholder="Your name" maxlength="60" required autofocus />
        <button class="btn" type="submit">Continue</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

function quizCard(q, best) {
  const bestPercent = best ? best.best_percent : null;
  const attempts = best ? best.attempts : 0;
  return `
  <div class="quiz-card">
    <h3>Practice Test ${q.num}</h3>
    <div style="color:var(--grey);font-size:0.85em;margin-top:-6px">${escapeHtml(q.title)}</div>
    <div class="quiz-meta">
      <span><i class="fas fa-list"></i> ${q.totalQuestions} questions</span>
      ${q.passPercent ? `<span><i class="fas fa-trophy"></i> Pass ${q.passPercent}%</span>` : ""}
      ${q.duration ? `<span><i class="far fa-clock"></i> ${Math.round(q.duration / 60)} min</span>` : ""}
    </div>
    <div class="quiz-best ${bestPercent == null ? "none" : ""}">
      ${bestPercent == null ? "Not attempted yet" : `Best score: ${bestPercent}% · ${attempts} attempt${attempts === 1 ? "" : "s"}`}
    </div>
    <a class="btn" href="/quiz/${q.key}">Start test</a>
  </div>`;
}

function dashboardPage({ user, quizzes, bestScores }) {
  const cards = quizzes.map((q) => quizCard(q, bestScores[q.key])).join("\n");
  return layout({
    title: "Dashboard — AWS SAA Practice Portal",
    user,
    active: "dashboard",
    body: `
    <div class="container">
      <h1>Practice tests</h1>
      <p class="subtitle">Pick a test to begin. Your results are saved automatically to your history.</p>
      <div class="quiz-grid">${cards}</div>
    </div>`,
  });
}

function historyRow(a) {
  const passed = a.passed == null ? null : !!a.passed;
  return `
  <tr>
    <td>${escapeHtml(a.finished_at)}</td>
    <td>${escapeHtml(a.quiz_title)}</td>
    <td><span class="badge mode-${a.mode}">${escapeHtml(a.mode)}</span></td>
    <td>${a.correct_count}/${a.total_questions} (${a.score_percent}%)</td>
    <td>${passed == null ? "—" : `<span class="badge ${passed ? "pass" : "fail"}">${passed ? "Passed" : "Failed"}</span>`}</td>
    <td>${a.duration_seconds != null ? formatDuration(a.duration_seconds) : "—"}</td>
    <td><a class="btn secondary" href="/history/${a.id}">Review</a></td>
  </tr>`;
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function historyPage({ user, attempts }) {
  const rows = attempts.map(historyRow).join("\n");
  return layout({
    title: "History — AWS SAA Practice Portal",
    user,
    active: "history",
    body: `
    <div class="container">
      <h1>Your exam history</h1>
      <p class="subtitle">All attempts across every practice test.</p>
      ${attempts.length === 0
        ? `<div class="empty-state"><i class="fas fa-inbox fa-2x"></i><p>No attempts yet. Go take a practice test!</p></div>`
        : `<table class="history">
            <thead><tr><th>Date</th><th>Quiz</th><th>Mode</th><th>Score</th><th>Result</th><th>Duration</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`}
    </div>`,
  });
}

function attemptDetailPage({ user, attempt, quiz }) {
  let answers = [];
  try { answers = JSON.parse(attempt.answers_json || "[]"); } catch (e) { answers = []; }

  const items = answers.map((a) => {
    const meta = quiz ? quiz.questionsById.get(String(a.questionId)) : null;
    const qText = meta ? meta.question.split("images/").join("/images/") : `Question ${a.questionId}`;
    const isMulti = meta && meta.correct && meta.correct.length > 1;

    let optionsHtml = "";
    if (meta && meta.answers) {
      optionsHtml = `<ul class="review-options">` + meta.answers.map((ansHtml, idx) => {
        const letter = String.fromCharCode(97 + idx); // 'a', 'b', ...
        const isSelected = a.selected && a.selected.includes(letter);
        const isCorrect = a.correct && a.correct.includes(letter);
        
        let optionClass = "review-option";
        if (isMulti) optionClass += " is-multi";

        if (isSelected && isCorrect) {
          optionClass += " user-correct";
        } else if (isSelected && !isCorrect) {
          optionClass += " user-wrong";
        } else if (!isSelected && isCorrect) {
          optionClass += " show-correct";
        }

        return `<li class="${optionClass}">
          <div class="chk"></div>
          <div class="opt-text"><strong>${letter.toUpperCase()}.</strong> ${ansHtml.split("images/").join("/images/")}</div>
        </li>`;
      }).join("\n") + `</ul>`;
    }

    const statusClass = a.status === "correct" ? "correct" : a.status === "skipped" ? "skipped" : "wrong";
    const explanationHtml = meta && meta.explanation
      ? meta.explanation.split("images/").join("/images/")
      : "";
    
    return `
    <div class="review-item">
      <div class="q-text">${qText}</div>
      ${optionsHtml}
      <div class="ans-line ${statusClass}"><i class="fas fa-${a.status === "correct" ? "check" : a.status === "skipped" ? "minus" : "times"}-circle"></i> Your result: <span style="text-transform: capitalize;">${escapeHtml(a.status)}</span></div>
      ${explanationHtml ? `<details class="review-explanation"><summary><i class="fas fa-lightbulb"></i> Explanation</summary><div class="exp-content">${explanationHtml}</div></details>` : ""}
    </div>`;
  }).join("\n");

  const passed = attempt.passed == null ? null : !!attempt.passed;

  return layout({
    title: "Attempt review — AWS SAA Practice Portal",
    user,
    active: "history",
    body: `
    <div class="container">
      <a href="/history" class="btn secondary" style="margin-bottom:18px;display:inline-block"><i class="fas fa-arrow-left"></i> Back to history</a>
      <h1>${escapeHtml(attempt.quiz_title)}</h1>
      <p class="subtitle">${escapeHtml(attempt.finished_at)} · <span class="badge mode-${attempt.mode}">${escapeHtml(attempt.mode)}</span></p>
      <div class="summary-box">
        <div class="stat"><span class="val">${attempt.score_percent}%</span><span class="lbl">Score</span></div>
        <div class="stat"><span class="val">${attempt.correct_count}</span><span class="lbl">Correct</span></div>
        <div class="stat"><span class="val">${attempt.wrong_count}</span><span class="lbl">Wrong</span></div>
        <div class="stat"><span class="val">${attempt.skipped_count}</span><span class="lbl">Skipped</span></div>
        <div class="stat"><span class="val">${passed == null ? "—" : passed ? "Pass" : "Fail"}</span><span class="lbl">Result</span></div>
        <div class="stat"><span class="val">${attempt.duration_seconds != null ? formatDuration(attempt.duration_seconds) : "—"}</span><span class="lbl">Duration</span></div>
      </div>
      <div class="review-list">${items || "<p>No per-question detail was recorded for this attempt.</p>"}</div>
    </div>`,
  });
}

module.exports = { loginPage, dashboardPage, historyPage, attemptDetailPage, escapeHtml };
