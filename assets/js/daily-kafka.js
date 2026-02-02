/**
 * Daily Kafka Quiz - Core Logic
 */

(function() {
  'use strict';

  // Storage key
  const STORAGE_KEY = 'kafkaQuiz';

  // Get questions from global variable (injected by Jekyll)
  let questions = [];

  // State
  let currentQuestion = null;
  let currentMode = 'quiz'; // 'quiz' or 'flashcard'
  let hasAnswered = false;
  let selectedOptionIndex = null;

  /**
   * Initialize the quiz
   */
  function init() {
    // Get questions from Jekyll-injected global
    if (typeof window.kafkaQuestions !== 'undefined') {
      questions = window.kafkaQuestions;
    }

    if (questions.length === 0) {
      console.error('No Kafka questions loaded');
      return;
    }

    // Load today's question
    currentQuestion = getTodaysQuestion();

    // Check if already answered today
    const storage = getStorage();
    const today = getTodayString();
    hasAnswered = storage.lastAnsweredDate === today;

    // Render UI
    renderQuestion();
    renderStats();

    // Bind events
    bindEvents();
  }

  /**
   * Get question for today (deterministic based on date)
   */
  function getTodaysQuestion() {
    const dayNumber = Math.floor(Date.now() / 86400000);
    const index = dayNumber % questions.length;
    return questions[index];
  }

  /**
   * Get today's date string
   */
  function getTodayString() {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Get storage data
   */
  function getStorage() {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      try {
        return JSON.parse(data);
      } catch (e) {
        return getDefaultStorage();
      }
    }
    return getDefaultStorage();
  }

  /**
   * Get default storage structure
   */
  function getDefaultStorage() {
    return {
      answeredQuestions: [],
      lastAnsweredDate: null,
      streak: 0,
      correctCount: 0,
      totalAnswered: 0
    };
  }

  /**
   * Save storage data
   */
  function saveStorage(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  /**
   * Render the current question
   */
  function renderQuestion() {
    const container = document.getElementById('question-container');
    if (!container || !currentQuestion) return;

    // Category display name
    const categoryNames = {
      'core-concepts': 'Core Concepts',
      'troubleshooting': 'Troubleshooting',
      'configuration': 'Configuration'
    };

    // Format category for display
    const categoryDisplay = categoryNames[currentQuestion.category] || currentQuestion.category;

    // Get day of year for display
    const start = new Date(new Date().getFullYear(), 0, 0);
    const diff = new Date() - start;
    const dayOfYear = Math.floor(diff / 86400000);

    container.innerHTML = `
      <div class="question-header">
        <div class="question-badges">
          <span class="badge badge-category">${categoryDisplay}</span>
          <span class="badge badge-difficulty ${currentQuestion.difficulty}">${currentQuestion.difficulty}</span>
        </div>
        <span class="question-day">Day ${dayOfYear} of 365</span>
      </div>

      <h2 class="question-text">${escapeHtml(currentQuestion.question)}</h2>

      <div class="mode-toggle">
        <button class="mode-btn ${currentMode === 'quiz' ? 'active' : ''}" data-mode="quiz">Quiz Mode</button>
        <button class="mode-btn ${currentMode === 'flashcard' ? 'active' : ''}" data-mode="flashcard">Flashcard Mode</button>
      </div>

      <div class="quiz-options ${currentMode === 'quiz' ? '' : 'hidden'}" id="quiz-options">
        ${currentQuestion.options.map((option, index) => {
          const letter = String.fromCharCode(65 + index);
          let classes = 'option-btn';
          if (hasAnswered) {
            if (index === currentQuestion.correct) {
              classes += ' correct';
            } else if (index === selectedOptionIndex && index !== currentQuestion.correct) {
              classes += ' incorrect';
            }
          }
          return `
            <button class="${classes}" data-index="${index}" ${hasAnswered ? 'disabled' : ''}>
              <span class="option-letter">${letter}</span>
              <span>${escapeHtml(option)}</span>
            </button>
          `;
        }).join('')}
      </div>

      <div class="flashcard-container ${currentMode === 'flashcard' ? 'active' : ''}" id="flashcard-container">
        <button class="reveal-btn ${hasAnswered ? 'hidden' : ''}" id="reveal-btn">Reveal Answer</button>
        <div class="flashcard-answer ${hasAnswered ? 'revealed' : ''}" id="flashcard-answer">
          <h4>Answer: ${escapeHtml(currentQuestion.options[currentQuestion.correct])}</h4>
          <p class="feedback-explanation">${escapeHtml(currentQuestion.explanation)}</p>
          ${currentQuestion.docs_link ? `
            <a href="${currentQuestion.docs_link}" class="docs-link" target="_blank" rel="noopener">
              Read the docs &rarr;
            </a>
          ` : ''}
        </div>
      </div>

      <div class="answer-feedback ${hasAnswered ? 'visible' : ''}" id="answer-feedback">
        <div class="feedback-header ${hasAnswered && selectedOptionIndex === currentQuestion.correct ? 'correct' : 'incorrect'}">
          ${hasAnswered && selectedOptionIndex === currentQuestion.correct ? 'Correct!' : hasAnswered ? 'Not quite!' : ''}
        </div>
        <p class="feedback-explanation">${escapeHtml(currentQuestion.explanation)}</p>
        ${currentQuestion.docs_link ? `
          <a href="${currentQuestion.docs_link}" class="docs-link" target="_blank" rel="noopener">
            Read the docs &rarr;
          </a>
        ` : ''}
      </div>
    `;

    // Hide quiz mode elements if in flashcard mode
    if (currentMode === 'flashcard') {
      const quizOptions = container.querySelector('#quiz-options');
      const feedback = container.querySelector('#answer-feedback');
      if (quizOptions) quizOptions.style.display = 'none';
      if (feedback) feedback.style.display = 'none';
    }
  }

  /**
   * Render stats section
   */
  function renderStats() {
    const container = document.getElementById('stats-container');
    if (!container) return;

    const storage = getStorage();

    container.innerHTML = `
      <div class="stat-card">
        <div class="stat-value streak-fire">${storage.streak}</div>
        <div class="stat-label">Day Streak</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${storage.totalAnswered}</div>
        <div class="stat-label">Questions Answered</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${storage.totalAnswered > 0 ? Math.round((storage.correctCount / storage.totalAnswered) * 100) : 0}%</div>
        <div class="stat-label">Accuracy</div>
      </div>
    `;
  }

  /**
   * Bind event handlers
   */
  function bindEvents() {
    // Mode toggle
    document.addEventListener('click', function(e) {
      if (e.target.matches('.mode-btn')) {
        const mode = e.target.dataset.mode;
        if (mode && mode !== currentMode) {
          currentMode = mode;
          renderQuestion();
        }
      }
    });

    // Quiz option selection
    document.addEventListener('click', function(e) {
      const optionBtn = e.target.closest('.option-btn');
      if (optionBtn && !hasAnswered && currentMode === 'quiz') {
        const index = parseInt(optionBtn.dataset.index, 10);
        handleAnswer(index);
      }
    });

    // Flashcard reveal
    document.addEventListener('click', function(e) {
      if (e.target.matches('#reveal-btn')) {
        handleFlashcardReveal();
      }
    });
  }

  /**
   * Handle answer selection
   */
  function handleAnswer(index) {
    if (hasAnswered) return;

    selectedOptionIndex = index;
    hasAnswered = true;

    const isCorrect = index === currentQuestion.correct;

    // Update storage
    const storage = getStorage();
    const today = getTodayString();
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Update streak
    if (storage.lastAnsweredDate === yesterday) {
      storage.streak += 1;
    } else if (storage.lastAnsweredDate !== today) {
      storage.streak = 1;
    }

    storage.lastAnsweredDate = today;
    storage.totalAnswered += 1;
    if (isCorrect) {
      storage.correctCount += 1;
    }

    // Track answered question
    if (!storage.answeredQuestions.includes(currentQuestion.id)) {
      storage.answeredQuestions.push(currentQuestion.id);
    }

    saveStorage(storage);

    // Re-render
    renderQuestion();
    renderStats();
  }

  /**
   * Handle flashcard reveal
   */
  function handleFlashcardReveal() {
    const revealBtn = document.getElementById('reveal-btn');
    const answer = document.getElementById('flashcard-answer');

    if (revealBtn) revealBtn.classList.add('hidden');
    if (answer) answer.classList.add('revealed');

    // Mark as answered (flashcard mode counts as answered)
    if (!hasAnswered) {
      hasAnswered = true;
      selectedOptionIndex = currentQuestion.correct; // Count as correct for flashcard

      const storage = getStorage();
      const today = getTodayString();
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

      if (storage.lastAnsweredDate === yesterday) {
        storage.streak += 1;
      } else if (storage.lastAnsweredDate !== today) {
        storage.streak = 1;
      }

      storage.lastAnsweredDate = today;
      storage.totalAnswered += 1;
      storage.correctCount += 1; // Flashcard counts as correct

      if (!storage.answeredQuestions.includes(currentQuestion.id)) {
        storage.answeredQuestions.push(currentQuestion.id);
      }

      saveStorage(storage);
      renderStats();
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
