/**
 * Inline quiz engine for blog posts.
 *
 * Usage:
 *   1. Add `quiz: <quiz-file>` to post front matter
 *   2. Use {% include quiz.html id="<id>" %} in the post body
 *   3. The include renders the HTML; this script wires up interactivity.
 *
 * Each .blog-quiz element stores its explanation texts in
 * data-success and data-fail attributes (set by the include).
 */
(function () {
  document.querySelectorAll('.blog-quiz').forEach(function (quiz) {
    var options     = quiz.querySelectorAll('.blog-quiz-option');
    var explanation = quiz.querySelector('.blog-quiz-explanation');
    var resetBtn    = quiz.querySelector('.blog-quiz-reset');
    var successMsg  = quiz.getAttribute('data-success');
    var failMsg     = quiz.getAttribute('data-fail');
    var answered    = false;

    options.forEach(function (option) {
      option.addEventListener('click', function () {
        if (answered) return;
        answered = true;

        var isCorrect = option.getAttribute('data-correct') === 'true';

        // Highlight correct / wrong
        options.forEach(function (opt) {
          opt.classList.add('selected');
          if (opt.getAttribute('data-correct') === 'true') {
            opt.classList.add('correct');
          } else if (opt === option && !isCorrect) {
            opt.classList.add('wrong');
          }
        });

        // Show explanation
        if (isCorrect) {
          explanation.innerHTML = successMsg;
          explanation.className = 'blog-quiz-explanation visible success';
        } else {
          explanation.innerHTML = failMsg;
          explanation.className = 'blog-quiz-explanation visible fail';
        }

        resetBtn.classList.add('visible');
      });
    });

    // Reset handler
    resetBtn.addEventListener('click', function () {
      answered = false;
      options.forEach(function (opt) {
        opt.classList.remove('selected', 'correct', 'wrong');
      });
      explanation.className = 'blog-quiz-explanation';
      explanation.innerHTML = '';
      resetBtn.classList.remove('visible');
    });
  });
})();