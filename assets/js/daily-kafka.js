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
  let browseMode = false;
  let browseIndex = 0;

  // Diagram state
  let selectedNodes = [];
  let dragState = {
    dragging: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    placements: {} // zoneId -> itemId
  };

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
      totalAnswered: 0,
      lastAnswerCorrect: null // Track if last answer was correct
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

    // Only reset diagram state when showing a new unanswered question
    if (!hasAnswered) {
      selectedNodes = [];
      dragState.placements = {};
    }

    // Category display name
    const categoryNames = {
      'core-concepts': 'Core Concepts',
      'troubleshooting': 'Troubleshooting',
      'configuration': 'Configuration',
      'kraft-architecture': 'KRaft Architecture',
      'replication': 'Replication & ISR',
      'fault-diagnosis': 'Fault Diagnosis'
    };

    // Format category for display
    const categoryDisplay = categoryNames[currentQuestion.category] || currentQuestion.category;

    // Get day of year for display
    const start = new Date(new Date().getFullYear(), 0, 0);
    const diff = new Date() - start;
    const dayOfYear = Math.floor(diff / 86400000);

    // Check if this is a diagram question
    const isDiagramQuestion = currentQuestion.type === 'diagram';

    container.innerHTML = `
      <div class="question-header">
        <div class="question-badges">
          <span class="badge badge-category">${categoryDisplay}</span>
          <span class="badge badge-difficulty ${currentQuestion.difficulty}">${currentQuestion.difficulty}</span>
          ${isDiagramQuestion ? '<span class="badge badge-interactive">Interactive</span>' : ''}
        </div>
        <span class="question-day">Day ${dayOfYear} of 365</span>
      </div>

      <h2 class="question-text">${escapeHtml(currentQuestion.question)}</h2>

      ${isDiagramQuestion ? renderDiagramContent() : renderTextQuestionContent()}
    `;

    // Initialize diagram interactions if needed
    if (isDiagramQuestion && !hasAnswered) {
      initDiagramInteractions();
    }
  }

  /**
   * Render text question content (original quiz/flashcard modes)
   */
  function renderTextQuestionContent() {
    // Determine if answer was correct - use stored value when returning to daily quiz
    let wasCorrect = selectedOptionIndex === currentQuestion.correct;
    if (hasAnswered && !browseMode && selectedOptionIndex === null) {
      // We're returning to an already-answered daily question, use stored value
      const storage = getStorage();
      wasCorrect = storage.lastAnswerCorrect === true;
    }

    return `
      <div class="mode-toggle">
        <button class="mode-btn ${currentMode === 'quiz' ? 'active' : ''}" data-mode="quiz">Quiz Mode</button>
        <button class="mode-btn ${currentMode === 'flashcard' ? 'active' : ''}" data-mode="flashcard">Flashcard Mode</button>
      </div>

      <div class="quiz-options ${currentMode === 'quiz' ? '' : 'hidden'}" id="quiz-options" ${currentMode === 'flashcard' ? 'style="display:none"' : ''}>
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

      <div class="answer-feedback ${hasAnswered ? 'visible' : ''}" id="answer-feedback" ${currentMode === 'flashcard' ? 'style="display:none"' : ''}>
        <div class="feedback-header ${hasAnswered && wasCorrect ? 'correct' : 'incorrect'}">
          ${hasAnswered ? (wasCorrect ? 'Correct!' : 'Not quite!') : ''}
        </div>
        <p class="feedback-explanation">${escapeHtml(currentQuestion.explanation)}</p>
        ${currentQuestion.docs_link ? `
          <a href="${currentQuestion.docs_link}" class="docs-link" target="_blank" rel="noopener">
            Read the docs &rarr;
          </a>
        ` : ''}
      </div>
    `;
  }

  /**
   * Render diagram question content
   */
  function renderDiagramContent() {
    const diagram = currentQuestion.diagram;
    const interactionType = diagram.interaction || 'click';
    const isMultiSelect = diagram.multi_select || false;

    let instructionText = '';
    let instructionIcon = '';

    if (interactionType === 'drag') {
      instructionText = 'Drag items to the correct positions';
      instructionIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><path d="M9 15l3-3 3 3"/><path d="M12 12v6"/></svg>';
    } else if (isMultiSelect) {
      instructionText = 'Click to select all correct elements, then submit';
      instructionIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>';
    } else {
      instructionText = 'Click on the correct element to answer';
      instructionIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l2 2"/></svg>';
    }

    let diagramHtml = '';
    switch (diagram.type) {
      case 'kraft-quorum':
        diagramHtml = renderKRaftQuorumDiagram(diagram);
        break;
      case 'broker-cluster':
        diagramHtml = renderBrokerClusterDiagram(diagram);
        break;
      case 'partition-replicas':
        diagramHtml = renderPartitionReplicasDiagram(diagram);
        break;
      case 'drag-topology':
        diagramHtml = renderDragTopologyDiagram(diagram);
        break;
      case 'heartbeat-timeline':
        diagramHtml = renderHeartbeatTimelineDiagram(diagram);
        break;
      default:
        diagramHtml = '<p>Unknown diagram type</p>';
    }

    // Determine if answer was correct - use stored value when returning to daily quiz
    let wasCorrect = checkDiagramCorrect();
    if (hasAnswered && !browseMode && selectedNodes.length === 0 && Object.keys(dragState.placements).length === 0) {
      // We're returning to an already-answered daily question, use stored value
      const storage = getStorage();
      wasCorrect = storage.lastAnswerCorrect === true;
    }

    return `
      <div class="diagram-instructions">
        ${instructionIcon}
        <span>${instructionText}</span>
      </div>

      <div class="diagram-container" id="diagram-container">
        ${diagramHtml}
      </div>

      ${isMultiSelect && !hasAnswered ? `
        <div class="multi-select-hint">
          <span>Selected: </span><span class="count" id="selected-count">0</span>
        </div>
        <button class="diagram-submit-btn" id="diagram-submit" disabled>Submit Answer</button>
      ` : ''}

      ${interactionType === 'drag' && !hasAnswered ? `
        <button class="diagram-submit-btn" id="diagram-submit" disabled>Check Answer</button>
      ` : ''}

      <div class="answer-feedback ${hasAnswered ? 'visible' : ''}" id="answer-feedback">
        <div class="feedback-header ${hasAnswered && wasCorrect ? 'correct' : 'incorrect'}">
          ${hasAnswered ? (wasCorrect ? 'Correct!' : 'Not quite!') : ''}
        </div>
        <p class="feedback-explanation">${escapeHtml(currentQuestion.explanation)}</p>
        ${currentQuestion.docs_link ? `
          <a href="${currentQuestion.docs_link}" class="docs-link" target="_blank" rel="noopener">
            Read the docs &rarr;
          </a>
        ` : ''}
      </div>
    `;
  }

  /**
   * Check if diagram answer is correct
   */
  function checkDiagramCorrect() {
    if (!currentQuestion || currentQuestion.type !== 'diagram') return false;

    const diagram = currentQuestion.diagram;
    const correct = currentQuestion.correct;

    if (diagram.interaction === 'drag') {
      // Check drag placements
      if (Array.isArray(correct)) {
        return correct.every(c => dragState.placements[c.zone] === c.item);
      }
      return Object.keys(correct).every(zone => dragState.placements[zone] === correct[zone]);
    } else if (diagram.multi_select) {
      // Check multi-select
      if (selectedNodes.length !== correct.length) return false;
      return correct.every(c => selectedNodes.includes(c));
    } else {
      // Single click
      return selectedNodes[0] === correct;
    }
  }

  /**
   * Render KRaft Quorum diagram
   */
  function renderKRaftQuorumDiagram(diagram) {
    const nodes = diagram.nodes || [];
    const nodeWidth = 110;
    const nodeHeight = 70;
    const spacing = 40;
    const totalWidth = nodes.length * nodeWidth + (nodes.length - 1) * spacing;
    const svgWidth = Math.max(totalWidth + 40, 400);
    const svgHeight = 160;

    let nodesHtml = nodes.map((node, idx) => {
      const x = 20 + idx * (nodeWidth + spacing);
      const y = 40;
      const isLeader = node.role === 'leader';
      const nodeClass = hasAnswered ?
        (currentQuestion.correct === node.id ? 'correct' :
          (selectedNodes.includes(node.id) ? 'incorrect' : 'disabled')) :
        'selectable';

      return `
        <g class="diagram-node ${nodeClass}" data-node-id="${node.id}" transform="translate(${x}, ${y})">
          <rect class="node-bg controller" x="0" y="0" width="${nodeWidth}" height="${nodeHeight}" rx="8"/>
          ${isLeader ? `
            <text class="node-icon leader-crown" x="${nodeWidth/2}" y="-8" text-anchor="middle" font-size="16">&#9733;</text>
          ` : ''}
          <text class="node-label" x="${nodeWidth/2}" y="25">${escapeHtml(node.label)}</text>
          <text class="node-sublabel" x="${nodeWidth/2}" y="45">${isLeader ? 'Leader' : 'Follower'}</text>
          ${node.epoch ? `<text class="node-sublabel" x="${nodeWidth/2}" y="58">Epoch: ${node.epoch}</text>` : ''}
        </g>
      `;
    }).join('');

    // Add connections between nodes
    let connectionsHtml = '';
    if (nodes.length > 1) {
      const leaderIdx = nodes.findIndex(n => n.role === 'leader');
      nodes.forEach((node, idx) => {
        if (idx !== leaderIdx && leaderIdx >= 0) {
          const x1 = 20 + leaderIdx * (nodeWidth + spacing) + nodeWidth/2;
          const x2 = 20 + idx * (nodeWidth + spacing) + nodeWidth/2;
          const y = 40 + nodeHeight + 15;
          connectionsHtml += `
            <path class="diagram-connection fetch" d="M${x1},${40 + nodeHeight} Q${(x1+x2)/2},${y} ${x2},${40 + nodeHeight}" marker-end="url(#arrowhead)"/>
          `;
        }
      });
    }

    return `
      <svg class="diagram-svg" viewBox="0 0 ${svgWidth} ${svgHeight}">
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon class="diagram-arrow" points="0 0, 10 3.5, 0 7" />
          </marker>
        </defs>
        ${connectionsHtml}
        ${nodesHtml}
      </svg>
    `;
  }

  /**
   * Render Broker Cluster diagram
   */
  function renderBrokerClusterDiagram(diagram) {
    const brokers = diagram.brokers || [];
    const partitions = diagram.partitions || [];
    const cols = Math.min(brokers.length, 4);
    const rows = Math.ceil(brokers.length / cols);
    const nodeWidth = 100;
    const nodeHeight = 80;
    const spacingX = 30;
    const spacingY = 30;
    const svgWidth = cols * nodeWidth + (cols - 1) * spacingX + 40;
    const svgHeight = rows * nodeHeight + (rows - 1) * spacingY + 80;

    let brokersHtml = brokers.map((broker, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = 20 + col * (nodeWidth + spacingX);
      const y = 20 + row * (nodeHeight + spacingY);

      const brokerPartitions = partitions.filter(p => p.broker === broker.id);
      const isFenced = broker.fenced || false;
      const nodeClass = hasAnswered ?
        (currentQuestion.correct === broker.id || (Array.isArray(currentQuestion.correct) && currentQuestion.correct.includes(broker.id)) ? 'correct' :
          (selectedNodes.includes(broker.id) ? 'incorrect' : 'disabled')) :
        'selectable';

      let partitionsHtml = brokerPartitions.map((p, pIdx) => {
        const px = 10 + (pIdx % 3) * 28;
        const py = 45 + Math.floor(pIdx / 3) * 18;
        const isLeader = p.role === 'leader';
        return `
          <rect x="${px}" y="${py}" width="24" height="14" rx="3"
                fill="${isLeader ? '#f59e0b' : '#6b7280'}" opacity="0.6"/>
          <text x="${px + 12}" y="${py + 10}" font-size="8" fill="white" text-anchor="middle">${p.name}</text>
        `;
      }).join('');

      return `
        <g class="diagram-node ${nodeClass} ${isFenced ? 'fenced' : ''}" data-node-id="${broker.id}" transform="translate(${x}, ${y})">
          <rect class="node-bg broker" x="0" y="0" width="${nodeWidth}" height="${nodeHeight}" rx="8"/>
          <text class="node-label" x="${nodeWidth/2}" y="20">${escapeHtml(broker.label)}</text>
          ${isFenced ? '<text class="node-sublabel" x="' + nodeWidth/2 + '" y="35" fill="#f472b6">FENCED</text>' : ''}
          ${partitionsHtml}
        </g>
      `;
    }).join('');

    return `
      <svg class="diagram-svg" viewBox="0 0 ${svgWidth} ${svgHeight}">
        ${brokersHtml}
      </svg>
    `;
  }

  /**
   * Render Partition Replicas diagram
   */
  function renderPartitionReplicasDiagram(diagram) {
    const replicas = diagram.replicas || [];
    const nodeWidth = 140;
    const nodeHeight = 50;
    const spacing = 15;
    const svgHeight = replicas.length * (nodeHeight + spacing) + 40;
    const svgWidth = 400;

    let replicasHtml = replicas.map((replica, idx) => {
      const x = 20;
      const y = 20 + idx * (nodeHeight + spacing);
      const isLeader = replica.role === 'leader';
      const isInSync = replica.in_sync !== false;

      const nodeClass = hasAnswered ?
        ((Array.isArray(currentQuestion.correct) && currentQuestion.correct.includes(replica.id)) ||
         currentQuestion.correct === replica.id ? 'correct' :
          (selectedNodes.includes(replica.id) ? 'incorrect' : 'disabled')) :
        'selectable';

      return `
        <g class="diagram-node ${nodeClass}" data-node-id="${replica.id}" transform="translate(${x}, ${y})">
          <rect class="node-bg ${isLeader ? 'partition-leader' : 'partition-follower'}"
                x="0" y="0" width="${nodeWidth}" height="${nodeHeight}" rx="8"/>
          <text class="node-label" x="15" y="22" text-anchor="start">${escapeHtml(replica.label)}</text>
          <text class="node-sublabel" x="15" y="38" text-anchor="start">
            ${isLeader ? 'Leader' : 'Follower'} | Offset: ${replica.offset || 0}
          </text>
          ${isInSync ? '' : '<text x="' + (nodeWidth - 10) + '" y="30" font-size="10" fill="#f472b6" text-anchor="end">LAG</text>'}
          ${isLeader ? '<text x="' + (nodeWidth - 10) + '" y="20" font-size="14" text-anchor="end">&#9733;</text>' : ''}
        </g>
        ${!isLeader && idx > 0 ? `
          <path class="diagram-connection fetch" d="M${x + nodeWidth + 10},${y + nodeHeight/2} L${x + nodeWidth + 40},${y + nodeHeight/2} L${x + nodeWidth + 40},${20 + nodeHeight/2}" marker-end="url(#arrowhead)"/>
        ` : ''}
      `;
    }).join('');

    return `
      <svg class="diagram-svg" viewBox="0 0 ${svgWidth} ${svgHeight}">
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon class="diagram-arrow" points="0 0, 10 3.5, 0 7" />
          </marker>
        </defs>
        ${replicasHtml}
      </svg>
    `;
  }

  /**
   * Render Drag Topology diagram
   */
  function renderDragTopologyDiagram(diagram) {
    const items = diagram.items || [];
    const zones = diagram.zones || [];

    let itemsHtml = items.map(item => `
      <div class="draggable" data-item-id="${item.id}" draggable="true">
        <span class="draggable-label">${escapeHtml(item.label)}</span>
      </div>
    `).join('');

    let zonesHtml = zones.map(zone => {
      const placedItem = Object.keys(dragState.placements).find(z => z === zone.id);
      const itemInZone = placedItem ? items.find(i => i.id === dragState.placements[zone.id]) : null;

      let zoneClass = 'drag-zone';
      if (hasAnswered) {
        const correctPlacement = Array.isArray(currentQuestion.correct) ?
          currentQuestion.correct.find(c => c.zone === zone.id) :
          currentQuestion.correct[zone.id];
        if (itemInZone && correctPlacement === itemInZone.id) {
          zoneClass += ' correct';
        } else if (itemInZone) {
          zoneClass += ' incorrect';
        }
      }
      if (itemInZone) {
        zoneClass += ' has-item';
      }

      return `
        <div class="drag-drop-column">
          <div class="drag-drop-column-header">${escapeHtml(zone.label)}</div>
          <div class="${zoneClass}" data-zone-id="${zone.id}">
            <span class="drag-zone-label">Drop here</span>
            ${itemInZone ? `
              <div class="draggable placed ${hasAnswered ? (zoneClass.includes('correct') ? 'correct' : 'incorrect') : ''}"
                   data-item-id="${itemInZone.id}" ${!hasAnswered ? 'draggable="true"' : ''}>
                <span class="draggable-label">${escapeHtml(itemInZone.label)}</span>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Filter out placed items from source
    const availableItems = items.filter(item =>
      !Object.values(dragState.placements).includes(item.id)
    );

    let availableItemsHtml = availableItems.map(item => `
      <div class="draggable" data-item-id="${item.id}" draggable="true">
        <span class="draggable-label">${escapeHtml(item.label)}</span>
      </div>
    `).join('');

    return `
      <div class="draggable-source" id="draggable-source">
        <span class="draggable-source-label">Available items:</span>
        ${availableItemsHtml || '<span style="color: var(--text-tertiary); font-style: italic;">All items placed</span>'}
      </div>
      <div class="drag-drop-layout">
        ${zonesHtml}
      </div>
    `;
  }

  /**
   * Render Heartbeat Timeline diagram
   */
  function renderHeartbeatTimelineDiagram(diagram) {
    const brokers = diagram.brokers || [];
    const timePoints = diagram.time_points || 5;
    const timeout = diagram.timeout || 3;

    let rowsHtml = brokers.map((broker, idx) => {
      const nodeClass = hasAnswered ?
        (currentQuestion.correct === broker.id ? 'correct' :
          (selectedNodes.includes(broker.id) ? 'incorrect' : 'disabled')) :
        'selectable';

      let eventsHtml = '';
      const heartbeats = broker.heartbeats || [];
      for (let t = 0; t < timePoints; t++) {
        const hasHeartbeat = heartbeats.includes(t);
        const leftPercent = (t / (timePoints - 1)) * 100;
        eventsHtml += `
          <div class="timeline-event ${hasHeartbeat ? '' : 'missed'}"
               style="left: ${leftPercent}%"
               title="t=${t}${hasHeartbeat ? '' : ' (missed)'}"></div>
        `;
      }

      return `
        <div class="timeline-row diagram-node ${nodeClass}" data-node-id="${broker.id}">
          <span class="timeline-label">${escapeHtml(broker.label)}</span>
          <div class="timeline-events">
            ${eventsHtml}
          </div>
        </div>
      `;
    }).join('');

    // Time axis labels
    let timeLabelsHtml = '';
    for (let t = 0; t < timePoints; t++) {
      const leftPercent = (t / (timePoints - 1)) * 100;
      timeLabelsHtml += `<span style="position: absolute; left: ${leftPercent}%; transform: translateX(-50%); font-size: 10px; color: var(--text-tertiary);">t${t}</span>`;
    }

    return `
      <div class="timeline-container">
        <div style="margin-left: 80px; margin-bottom: 0.5rem; position: relative; height: 20px;">
          ${timeLabelsHtml}
        </div>
        ${rowsHtml}
        <div style="margin-left: 80px; margin-top: 0.5rem; font-size: 0.8rem; color: var(--text-tertiary);">
          Timeout: ${timeout} missed heartbeats
        </div>
      </div>
    `;
  }

  /**
   * Initialize diagram interactions
   */
  function initDiagramInteractions() {
    const container = document.getElementById('diagram-container');
    if (!container) return;

    const diagram = currentQuestion.diagram;
    const interactionType = diagram.interaction || 'click';

    if (interactionType === 'drag') {
      initDragDrop();
    } else {
      initClickSelect();
    }
  }

  /**
   * Initialize click-to-select interactions
   */
  function initClickSelect() {
    const nodes = document.querySelectorAll('.diagram-node.selectable');
    const isMultiSelect = currentQuestion.diagram.multi_select || false;

    nodes.forEach(node => {
      node.addEventListener('click', function() {
        if (hasAnswered) return;

        const nodeId = this.dataset.nodeId;

        if (isMultiSelect) {
          if (selectedNodes.includes(nodeId)) {
            selectedNodes = selectedNodes.filter(id => id !== nodeId);
            this.classList.remove('selected');
          } else {
            selectedNodes.push(nodeId);
            this.classList.add('selected');
          }
          updateMultiSelectCount();
          updateSubmitButton();
        } else {
          // Single select - answer immediately
          selectedNodes = [nodeId];
          handleDiagramAnswer();
        }
      });
    });

    // Multi-select submit button
    const submitBtn = document.getElementById('diagram-submit');
    if (submitBtn && isMultiSelect) {
      submitBtn.addEventListener('click', function() {
        if (selectedNodes.length > 0) {
          handleDiagramAnswer();
        }
      });
    }
  }

  /**
   * Initialize drag-and-drop interactions
   * Uses mouse events for cross-browser compatibility (Firefox fix)
   */
  function initDragDrop() {
    const draggables = document.querySelectorAll('.draggable');

    draggables.forEach(draggable => {
      // Remove draggable attribute - we'll use mouse events instead
      draggable.removeAttribute('draggable');

      // Mouse events (works in all browsers including Firefox)
      draggable.addEventListener('mousedown', handleMouseDown);

      // Touch events for mobile
      draggable.addEventListener('touchstart', handleTouchStart, { passive: false });
      draggable.addEventListener('touchmove', handleTouchMove, { passive: false });
      draggable.addEventListener('touchend', handleTouchEnd);
    });

    // Submit button
    const submitBtn = document.getElementById('diagram-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', function() {
        handleDiagramAnswer();
      });
    }
  }

  // Mouse handlers for desktop (Firefox-compatible)
  function handleMouseDown(e) {
    if (hasAnswered) return;
    e.preventDefault();

    dragState.dragging = e.target.closest('.draggable');
    if (!dragState.dragging) return;

    const rect = dragState.dragging.getBoundingClientRect();
    dragState.offsetX = e.clientX - rect.left;
    dragState.offsetY = e.clientY - rect.top;
    dragState.originalParent = dragState.dragging.parentElement;

    dragState.dragging.classList.add('dragging');
    dragState.dragging.style.position = 'fixed';
    dragState.dragging.style.zIndex = '1000';
    dragState.dragging.style.left = (e.clientX - dragState.offsetX) + 'px';
    dragState.dragging.style.top = (e.clientY - dragState.offsetY) + 'px';
    dragState.dragging.style.width = rect.width + 'px';

    // Add document-level listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e) {
    if (!dragState.dragging) return;
    e.preventDefault();

    dragState.dragging.style.left = (e.clientX - dragState.offsetX) + 'px';
    dragState.dragging.style.top = (e.clientY - dragState.offsetY) + 'px';

    // Highlight drop zones
    document.querySelectorAll('.drag-zone').forEach(zone => {
      const rect = zone.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        zone.classList.add('drop-target');
      } else {
        zone.classList.remove('drop-target');
      }
    });
  }

  function handleMouseUp(e) {
    if (!dragState.dragging || hasAnswered) {
      cleanupMouseDrag();
      return;
    }

    const itemId = dragState.dragging.dataset.itemId;
    let droppedInZone = false;

    // Check if dropped on a zone
    document.querySelectorAll('.drag-zone').forEach(zone => {
      const rect = zone.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const zoneId = zone.dataset.zoneId;

        // Remove item from previous placement
        Object.keys(dragState.placements).forEach(z => {
          if (dragState.placements[z] === itemId) {
            delete dragState.placements[z];
          }
        });

        // Place item in zone
        dragState.placements[zoneId] = itemId;
        droppedInZone = true;
      }
    });

    // Check if dropped on source area
    const source = document.getElementById('draggable-source');
    if (source) {
      const sourceRect = source.getBoundingClientRect();
      if (e.clientX >= sourceRect.left && e.clientX <= sourceRect.right &&
          e.clientY >= sourceRect.top && e.clientY <= sourceRect.bottom) {
        // Remove from any zone
        Object.keys(dragState.placements).forEach(z => {
          if (dragState.placements[z] === itemId) {
            delete dragState.placements[z];
          }
        });
        droppedInZone = true;
      }
    }

    // Clean up and re-render
    cleanupMouseDrag();

    const container = document.getElementById('diagram-container');
    container.innerHTML = renderDragTopologyDiagram(currentQuestion.diagram);
    initDragDrop();
    updateSubmitButton();
  }

  function cleanupMouseDrag() {
    if (dragState.dragging) {
      dragState.dragging.classList.remove('dragging');
      dragState.dragging.style.position = '';
      dragState.dragging.style.zIndex = '';
      dragState.dragging.style.left = '';
      dragState.dragging.style.top = '';
      dragState.dragging.style.width = '';
      dragState.dragging = null;
    }
    document.querySelectorAll('.drag-zone').forEach(zone => {
      zone.classList.remove('drop-target');
    });
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }

  // Touch handlers for mobile
  function handleTouchStart(e) {
    if (hasAnswered) return;
    e.preventDefault();
    const touch = e.touches[0];
    dragState.dragging = e.target.closest('.draggable');
    if (!dragState.dragging) return;

    dragState.startX = touch.clientX;
    dragState.startY = touch.clientY;

    const rect = dragState.dragging.getBoundingClientRect();
    dragState.offsetX = touch.clientX - rect.left;
    dragState.offsetY = touch.clientY - rect.top;

    dragState.dragging.classList.add('dragging');
    dragState.dragging.style.position = 'fixed';
    dragState.dragging.style.zIndex = '1000';
    dragState.dragging.style.left = (touch.clientX - dragState.offsetX) + 'px';
    dragState.dragging.style.top = (touch.clientY - dragState.offsetY) + 'px';
    dragState.dragging.style.width = rect.width + 'px';
  }

  function handleTouchMove(e) {
    e.preventDefault();
    if (!dragState.dragging) return;

    const touch = e.touches[0];
    dragState.dragging.style.left = (touch.clientX - dragState.offsetX) + 'px';
    dragState.dragging.style.top = (touch.clientY - dragState.offsetY) + 'px';

    // Highlight drop target
    document.querySelectorAll('.drag-zone').forEach(zone => {
      const rect = zone.getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
          touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        zone.classList.add('drop-target');
      } else {
        zone.classList.remove('drop-target');
      }
    });
  }

  function handleTouchEnd(e) {
    if (!dragState.dragging || hasAnswered) return;

    const touch = e.changedTouches[0];
    const itemId = dragState.dragging.dataset.itemId;

    // Find drop target
    let targetZone = null;
    document.querySelectorAll('.drag-zone').forEach(zone => {
      const rect = zone.getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
          touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        targetZone = zone;
      }
    });

    // Check if dropped on source
    const source = document.getElementById('draggable-source');
    let droppedOnSource = false;
    if (source) {
      const rect = source.getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
          touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        droppedOnSource = true;
      }
    }

    // Remove from previous placement
    Object.keys(dragState.placements).forEach(z => {
      if (dragState.placements[z] === itemId) {
        delete dragState.placements[z];
      }
    });

    if (targetZone) {
      const zoneId = targetZone.dataset.zoneId;
      dragState.placements[zoneId] = itemId;
    }

    // Reset drag state
    dragState.dragging.classList.remove('dragging');
    dragState.dragging.style.position = '';
    dragState.dragging.style.zIndex = '';
    dragState.dragging.style.left = '';
    dragState.dragging.style.top = '';
    dragState.dragging.style.width = '';
    dragState.dragging = null;

    // Clear highlights
    document.querySelectorAll('.drag-zone').forEach(zone => {
      zone.classList.remove('drop-target');
    });

    // Re-render
    const container = document.getElementById('diagram-container');
    container.innerHTML = renderDragTopologyDiagram(currentQuestion.diagram);
    initDragDrop();
    updateSubmitButton();
  }

  /**
   * Update multi-select count display
   */
  function updateMultiSelectCount() {
    const countEl = document.getElementById('selected-count');
    if (countEl) {
      countEl.textContent = selectedNodes.length;
    }
  }

  /**
   * Update submit button state
   */
  function updateSubmitButton() {
    const submitBtn = document.getElementById('diagram-submit');
    if (!submitBtn) return;

    const diagram = currentQuestion.diagram;
    if (diagram.interaction === 'drag') {
      const zones = diagram.zones || [];
      const allFilled = zones.every(z => dragState.placements[z.id]);
      submitBtn.disabled = !allFilled;
    } else if (diagram.multi_select) {
      submitBtn.disabled = selectedNodes.length === 0;
    }
  }

  /**
   * Handle diagram answer submission
   */
  function handleDiagramAnswer() {
    if (hasAnswered) return;

    hasAnswered = true;
    const isCorrect = checkDiagramCorrect();

    // Update storage
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
    storage.lastAnswerCorrect = isCorrect; // Store whether answer was correct
    if (isCorrect) {
      storage.correctCount += 1;
    }

    if (!storage.answeredQuestions.includes(currentQuestion.id)) {
      storage.answeredQuestions.push(currentQuestion.id);
    }

    saveStorage(storage);

    // Re-render to show feedback
    renderQuestion();
    renderStats();
  }

  /**
   * Render stats section
   */
  function renderStats() {
    const container = document.getElementById('stats-container');
    if (!container) return;

    const storage = getStorage();

    if (browseMode) {
      container.innerHTML = `
        <div class="browse-header">
          <button class="browse-toggle-btn active" id="exit-browse">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back to Daily
          </button>
          <span class="browse-counter">Question ${browseIndex + 1} of ${questions.length}</span>
        </div>
        <div class="browse-nav">
          <button class="browse-nav-btn" id="browse-prev" ${browseIndex === 0 ? 'disabled' : ''}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
            Prev
          </button>
          <select class="browse-select" id="browse-select">
            ${questions.map((q, i) => `<option value="${i}" ${i === browseIndex ? 'selected' : ''}>Q${i + 1}: ${escapeHtml(q.question.substring(0, 40))}...</option>`).join('')}
          </select>
          <button class="browse-nav-btn" id="browse-next" ${browseIndex === questions.length - 1 ? 'disabled' : ''}>
            Next
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>
      `;
    } else {
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
        <button class="browse-toggle-btn" id="enter-browse">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
          </svg>
          Browse All (${questions.length})
        </button>
      `;
    }
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

    // Browse mode toggle
    document.addEventListener('click', function(e) {
      const enterBtn = e.target.closest('#enter-browse');
      const exitBtn = e.target.closest('#exit-browse');

      if (enterBtn) {
        browseMode = true;
        browseIndex = 0;
        currentQuestion = questions[browseIndex];
        hasAnswered = false;
        selectedOptionIndex = null;
        renderQuestion();
        renderStats();
      }

      if (exitBtn) {
        browseMode = false;
        currentQuestion = getTodaysQuestion();
        const storage = getStorage();
        const today = getTodayString();
        hasAnswered = storage.lastAnsweredDate === today;
        selectedOptionIndex = null;
        renderQuestion();
        renderStats();
      }
    });

    // Browse navigation
    document.addEventListener('click', function(e) {
      const prevBtn = e.target.closest('#browse-prev');
      const nextBtn = e.target.closest('#browse-next');

      if (prevBtn && browseIndex > 0) {
        browseIndex--;
        currentQuestion = questions[browseIndex];
        hasAnswered = false;
        selectedOptionIndex = null;
        renderQuestion();
        renderStats();
      }

      if (nextBtn && browseIndex < questions.length - 1) {
        browseIndex++;
        currentQuestion = questions[browseIndex];
        hasAnswered = false;
        selectedOptionIndex = null;
        renderQuestion();
        renderStats();
      }
    });

    // Browse select dropdown
    document.addEventListener('change', function(e) {
      if (e.target.matches('#browse-select')) {
        browseIndex = parseInt(e.target.value, 10);
        currentQuestion = questions[browseIndex];
        hasAnswered = false;
        selectedOptionIndex = null;
        renderQuestion();
        renderStats();
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
    storage.lastAnswerCorrect = isCorrect; // Store whether answer was correct
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
      storage.lastAnswerCorrect = true; // Flashcard always counts as correct

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
