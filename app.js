/* ================================================================
   FORGE44 COMPILER â€” app.js
   Multi-stage pipeline: Intent â†’ Design â†’ Schema â†’ Refine â†’ Validate â†’ Repair â†’ Runtime
   ================================================================ */

/* ================================================================
   SAMPLE PROMPTS
   ================================================================ */
const samples = {
  crm:
    "Build a CRM with login, contacts, dashboard, role-based access, and premium plan with payments. Admins can see analytics. Sales reps manage contacts and deals.",
  marketplace:
    "Create a two-sided marketplace for tutors and students. Tutors list courses, students book sessions, admins review payments, and premium tutors get promoted search placement.",
  conflict:
    "Build a finance dashboard where guests can see all private payroll analytics, but payroll data must only be visible to admins. Include invoices and approval workflow.",
  vague:
    "Make me an internal business app with users, reports, and some automation. It should be simple but powerful."
};

/* ================================================================
   EVALUATION PROMPT DATASET (10 real + 10 edge cases)
   ================================================================ */
const evaluationPrompts = [
  // Real-world prompts
  "Build a CRM with contacts, companies, deals, login, admin analytics, and paid premium features.",
  "Create an appointment booking app for clinics with doctors, patients, calendar, reminders, and billing.",
  "Build a project management tool with tasks, teams, comments, files, roles, and client dashboards.",
  "Make an ecommerce admin for products, inventory, orders, coupons, payments, and warehouse staff.",
  "Build an HR platform with employee profiles, leave requests, payroll, org chart, and manager approvals.",
  "Create a real estate listing platform with property search, agents, inquiries, and premium listings.",
  "Build a SaaS analytics dashboard with user metrics, funnels, A/B tests, reports, and billing.",
  "Make a food delivery admin with restaurants, menus, orders, drivers, and customer support roles.",
  "Build a learning management system with courses, students, assignments, grades, and instructor roles.",
  "Create a legal case management system with matters, documents, billing, clients, and attorney access.",
  // Edge cases
  "Build a CRM but make guest users able to delete all contacts. Admins have read-only access.",
  "Make an app where everyone is an admin and nobody can log in.",
  "Create something.",
  "Build a marketplace without any product or payment functionality but call it a marketplace.",
  "Make a HIPAA-compliant healthcare app where patient data is publicly accessible.",
  "Build an app with roles: god, demigod, mortal â€” where mortals can see god-level financial reports.",
  "Create a social network where users can impersonate admins through the profile page.",
  "Build an app with 50 pages, all requiring admin access, and a guest landing page that shows all data.",
  "Make a finance app where the free plan has full analytics and the paid plan has nothing.",
  "Build an app. It should be good."
];

/* ================================================================
   DETERMINISTIC METRIC  (replaces Math.random â€” consistent values)
   ================================================================ */
function deterministicMetric(seed, lo = 120, hi = 9800) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return lo + (h % (hi - lo));
}

function deterministicChange(seed) {
  let h = 0;
  for (let c of seed) h = ((h * 31) + c.charCodeAt(0)) | 0;
  const pct  = ((Math.abs(h) % 200) + 1) / 10;
  const sign = h < 0 ? 'âˆ’' : '+';
  return `${sign}${pct.toFixed(1)}% vs last period`;
}

/* ================================================================
   THEME TOGGLE
   ================================================================ */
(function initTheme() {
  const saved = localStorage.getItem('forge44-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = saved === 'dark' ? 'â˜€ï¸' : 'ðŸŒ™';
})();

document.getElementById('themeToggle')?.addEventListener('click', () => {
  const html    = document.documentElement;
  const current = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', current);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = current === 'dark' ? 'â˜€ï¸' : 'ðŸŒ™';
  localStorage.setItem('forge44-theme', current);
});

/* ================================================================
   NAV CTA â†’ scroll to prompt
   ================================================================ */
document.getElementById('navCta')?.addEventListener('click', () => {
  document.getElementById('promptInput')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => document.getElementById('promptInput')?.focus(), 400);
});

/* ================================================================
   NAV BENCHMARK SHORTCUT
   ================================================================ */
document.getElementById('navRunEval')?.addEventListener('click', (e) => {
  e.preventDefault();
  const evalSection = document.getElementById('outputSection');
  if (!evalSection.classList.contains('hidden')) {
    switchTab('evaluation');
    evalSection.scrollIntoView({ behavior: 'smooth' });
  } else {
    alert('Compile a prompt first, then run the benchmark.');
  }
});

/* ================================================================
   CHAR COUNT
   ================================================================ */
document.getElementById('promptInput')?.addEventListener('input', function () {
  const el = document.getElementById('charCount');
  if (el) el.textContent = this.value.length;
});

/* ================================================================
   CLEAR PROMPT
   ================================================================ */
document.getElementById('clearPrompt')?.addEventListener('click', () => {
  const ta = document.getElementById('promptInput');
  if (ta) { ta.value = ''; ta.focus(); }
  const cc = document.getElementById('charCount');
  if (cc) cc.textContent = '0';
});

/* ================================================================
   SAMPLE CHIPS
   ================================================================ */
document.querySelectorAll('.sample-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sample;
    if (!samples[key]) return;
    const ta = document.getElementById('promptInput');
    if (ta) {
      ta.value = samples[key];
      const cc = document.getElementById('charCount');
      if (cc) cc.textContent = ta.value.length;
      ta.focus();
    }
  });
});

/* ================================================================
   PLAN TOGGLE
   ================================================================ */
let planMode = false;
document.getElementById('planToggle')?.addEventListener('click', function () {
  planMode = !planMode;
  this.classList.toggle('on', planMode);
  this.setAttribute('aria-checked', String(planMode));
});

/* ================================================================
   TAB SWITCHING
   ================================================================ */
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.dataset.tab === name;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === name + 'View');
  });
}
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

/* ================================================================
   SET LOADING STATE
   ================================================================ */
function setLoading(on) {
  const btn  = document.getElementById('generateBtn');
  const icon = document.getElementById('sendIcon');
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('loading', on);
  if (icon) icon.style.display = on ? 'none' : '';
  if (on && !document.getElementById('sendSpinner')) {
    const s = document.createElement('span');
    s.id = 'sendSpinner';
    s.textContent = 'âŸ³';
    s.style.cssText = 'font-size:1rem;line-height:1;';
    btn.appendChild(s);
  } else if (!on) {
    document.getElementById('sendSpinner')?.remove();
  }
  const nav = document.getElementById('navStatus');
  if (nav) nav.textContent = on ? 'Compilingâ€¦' : 'Ready';
}

/* ================================================================
   REVEAL SECTIONS
   ================================================================ */
function revealSections() {
  ['aiSection', 'outputSection'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('hidden');
      el.classList.add('anim-in');
    }
  });
}

/* ================================================================
   AI LOG ANIMATION
   ================================================================ */
let aiLogTimer = null;

function startAiLog(promptText) {
  clearAiLog();

  // User row
  const appName = guessAppName(promptText);
  const el = document.getElementById('aiUserName');
  if (el) el.textContent = appName;
  const init = document.getElementById('aiUserInitial');
  if (init) init.textContent = appName.charAt(0).toUpperCase();
  const pv = document.getElementById('aiUserPrompt');
  if (pv) pv.textContent = promptText.length > 200
    ? promptText.slice(0, 197) + 'â€¦'
    : promptText;

  // AI intro
  const intro = document.getElementById('aiIntroText');
  if (intro) intro.textContent = `I'll build a ${appName.toLowerCase()} application. Analyzing requirementsâ€¦`;
}

function guessAppName(prompt) {
  const p = prompt.toLowerCase();
  if (p.includes('crm'))         return 'CRM System';
  if (p.includes('marketplace')) return 'Marketplace';
  if (p.includes('hr ') || p.includes('human resource')) return 'HR Platform';
  if (p.includes('ecommerce') || p.includes('shop')) return 'E-Commerce Admin';
  if (p.includes('booking') || p.includes('appointment')) return 'Booking App';
  if (p.includes('project'))     return 'Project Tool';
  if (p.includes('analytics') || p.includes('dashboard')) return 'Analytics Dashboard';
  if (p.includes('learning') || p.includes('lms')) return 'LMS Platform';
  if (p.includes('finance') || p.includes('payroll')) return 'Finance App';
  if (p.includes('legal') || p.includes('case')) return 'Case Manager';
  if (p.includes('real estate') || p.includes('property')) return 'Realty Platform';
  if (p.includes('food') || p.includes('delivery')) return 'Delivery Admin';
  if (p.includes('social') || p.includes('network')) return 'Social Network';
  if (p.includes('saas'))        return 'SaaS Platform';
  return 'My App';
}

function appendAiStep(verb, obj, delay) {
  return new Promise(resolve => {
    aiLogTimer = setTimeout(() => {
      const list = document.getElementById('aiStepsList');
      if (!list) return resolve();
      const item = document.createElement('div');
      item.className = 'ai-step';
      item.setAttribute('role', 'listitem');
      item.innerHTML = `
        <span class="ai-step-icon" aria-hidden="true">âœ“</span>
        <span class="ai-step-verb">${verb}</span>
        <span class="ai-step-obj">${obj}</span>
      `;
      list.appendChild(item);
      resolve();
    }, delay);
  });
}

function clearAiLog() {
  if (aiLogTimer) clearTimeout(aiLogTimer);
  const list = document.getElementById('aiStepsList');
  if (list) list.innerHTML = '';
  const suc = document.getElementById('aiSuccess');
  if (suc) suc.classList.add('hidden');
}

async function showAiSteps(result) {
  const r   = result;
  const cfg = r.config;
  let delay = 0;
  const STEP = 280;   // ms between steps

  const featureCount  = r.intent.features?.length ?? '?';
  const roleCount     = r.intent.roles?.length ?? '?';
  const entityCount   = r.architecture?.entities?.length ?? '?';
  const flowCount     = r.architecture?.flows?.length ?? '?';
  const pageCount     = cfg.ui?.pages?.length ?? '?';
  const endpointCount = cfg.api?.endpoints?.length ?? '?';
  const tableCount    = cfg.database?.tables?.length ?? '?';
  const fieldCount    = cfg.database?.tables?.reduce((n,t) => n + (t.fields?.length ?? 0), 0) ?? '?';
  const ruleCount     = cfg.business_logic?.rules?.length ?? '?';

  await appendAiStep('Analyzed',    `prompt â€¢ ${featureCount} features, ${roleCount} roles detected`,                           delay); delay += STEP;
  await appendAiStep('Designed',    `system architecture â€¢ ${entityCount} entities, ${flowCount} user flows`,                   delay); delay += STEP;
  await appendAiStep('Wrote',       `UI config â€¢ ${pageCount} pages`,                                                           delay); delay += STEP;
  await appendAiStep('Created',     `API schema â€¢ ${endpointCount} endpoints`,                                                  delay); delay += STEP;
  await appendAiStep('Built',       `database â€¢ ${tableCount} tables, ${fieldCount} fields`,                                    delay); delay += STEP;
  await appendAiStep('Configured',  `auth â€¢ ${roleCount} roles, ${r.validation?.summary?.permissions ?? '?'} permissions`,     delay); delay += STEP;
  if (ruleCount && ruleCount !== '?') {
    await appendAiStep('Wrote', `${ruleCount} business rule${ruleCount !== 1 ? 's' : ''} (gating, validation, flow)`,           delay); delay += STEP;
  }
  if (r.repair?.loops > 0) {
    await appendAiStep('Repaired', `${r.repair.log?.length ?? r.repair.loops} issue${r.repair.loops > 1 ? 's' : ''} automatically`, delay); delay += STEP;
  }
  const totalContracts = (r.validation?.summary?.tables ?? 0) +
                         (r.validation?.summary?.endpoints ?? 0) +
                         (r.validation?.summary?.pages ?? 0);
  await appendAiStep('Verified',   `${totalContracts} cross-layer schema contracts`,                                             delay); delay += STEP;

  setTimeout(() => {
    const suc = document.getElementById('aiSuccess');
    if (suc) {
      suc.classList.remove('hidden');
      const stats = document.getElementById('successStats');
      if (stats) stats.innerHTML = `<strong>${pageCount} pages, ${endpointCount} endpoints, ${tableCount} tables</strong>`;
    }
  }, delay + 100);
}

/* ================================================================
   UPDATE AI SECTION BADGES & STATS
   ================================================================ */
function updateAiBadges(result) {
  const passed = result.validation?.passed;
  const loops  = result.repair?.loops ?? 0;

  const bv = document.getElementById('aiBadgeVal');
  if (bv) {
    bv.textContent = passed ? 'âœ“ Validated' : 'âš  Issues found';
    bv.className   = `ai-badge ${passed ? 'pass' : 'warn'}`;
  }
  const br = document.getElementById('aiBadgeRun');
  if (br) {
    const runnable = result.runtime?.pages?.length > 0;
    br.textContent = runnable ? 'âš¡ Executable' : 'â€” Not runnable';
    br.className   = `ai-badge ${runnable ? 'run' : 'warn'}`;
  }
  const brep = document.getElementById('aiBadgeRep');
  if (brep) {
    brep.textContent = `${loops} repair${loops !== 1 ? 's' : ''}`;
    brep.className   = `ai-badge ${loops > 0 ? 'repair' : 'pass'}`;
  }
}

/* ================================================================
   UPDATE STAT CARDS
   ================================================================ */
function updateStats(result) {
  const passed  = result.validation?.passed;
  const loops   = result.repair?.loops ?? 0;
  const quality = result.validation?.qualityScore ?? 0;

  setStatCard('heroValidation', 'statValidation',
    passed ? 'Passed' : 'Issues',
    passed ? 'is-pass' : 'is-fail');

  const pageCount = result.runtime?.pages?.length ?? 0;
  setStatCard('heroRuntime', 'statRuntime',
    pageCount > 0 ? `${pageCount} Pages` : 'Blocked',
    pageCount > 0 ? 'is-pass' : 'is-fail');

  setStatCard('heroRepairs', 'statRepairs',
    String(loops),
    loops > 0 ? 'is-accent' : 'is-pass');

  setStatCard('heroQuality', 'statQuality',
    `${quality}%`,
    quality >= 80 ? 'is-pass' : quality >= 50 ? '' : 'is-fail');
}

function setStatCard(valueId, cardId, text, modifier) {
  const el = document.getElementById(valueId);
  if (el) el.textContent = text;
  const card = document.getElementById(cardId);
  if (!card) return;
  card.classList.remove('is-pass', 'is-fail', 'is-accent');
  if (modifier) card.classList.add(modifier);
}

/* ================================================================
   RENDER PIPELINE STAGES
   ================================================================ */
function renderPipeline(stages) {
  const container = document.getElementById('pipeline');
  if (!container) return;
  container.innerHTML = '';
  stages.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = `stage ${s.status || ''}`;
    el.setAttribute('role', 'listitem');
    el.style.animationDelay = `${i * 80}ms`;
    el.innerHTML = `
      <div class="stage-progress"></div>
      <div class="stage-num">${String(i + 1).padStart(2, '0')}</div>
      <div class="stage-name">${s.name}</div>
      <div class="stage-detail">${s.description || ''}</div>
      <div class="stage-ms">${s.ms != null ? s.ms + 'ms' : 'â€”'}</div>
    `;
    container.appendChild(el);
  });
}

/* ================================================================
   RUNTIME PREVIEW RENDERER
   ================================================================ */
function renderRuntime(runtime, config) {
  const container = document.getElementById('appPreview');
  if (!container) return;
  if (!runtime?.pages?.length) {
    container.innerHTML = `<div class="preview-empty"><div class="preview-empty-icon">ðŸš«</div><p class="preview-empty-text">No runnable pages generated</p></div>`;
    return;
  }

  const appName = config?.app?.name || 'My App';
  const pages   = runtime.pages;

  // Nav sidebar
  let navItems = pages.map((p, i) => `
    <button class="pf-nav-item${i === 0 ? ' active' : ''}"
      data-page="${i}" id="navItem${i}" aria-label="Go to ${p.name}">
      ${pageIcon(p.name)} ${p.name}
    </button>
  `).join('');

  const frame = document.createElement('div');
  frame.className = 'preview-frame';
  frame.innerHTML = `
    <nav class="pf-nav" aria-label="App navigation">
      <div class="pf-nav-brand">
        <div class="pf-nav-icon" aria-hidden="true">ðŸ”¥</div>
        <span class="pf-nav-name">${escHtml(appName)}</span>
      </div>
      ${navItems}
    </nav>
    <div class="pf-content" id="pfContent" aria-live="polite"></div>
  `;
  container.innerHTML = '';
  container.appendChild(frame);

  function showPage(idx) {
    frame.querySelectorAll('.pf-nav-item').forEach((b, i) => {
      b.classList.toggle('active', i === idx);
    });
    const content = frame.querySelector('#pfContent');
    if (content) renderPage(content, pages[idx], config, appName);
  }

  frame.querySelectorAll('.pf-nav-item').forEach((b, i) => {
    b.addEventListener('click', () => showPage(i));
  });
  showPage(0);

  // Runtime checks sidebar
  renderRuntimeChecks(runtime);
}

function renderPage(container, page, config, appName) {
  const roles = (page.accessible_by || [])
    .map(r => `<span class="pf-role-badge">${escHtml(r)}</span>`).join('');

  let componentsHtml = '<div class="comp-grid">';
  (page.components || []).forEach(comp => {
    componentsHtml += renderComponent(comp, config, appName);
  });
  componentsHtml += '</div>';

  container.innerHTML = `
    <div class="pf-header">
      <div>
        <span class="pf-route">${escHtml(page.route || '/' + page.name.toLowerCase().replace(/\s+/g,'-'))}</span>
        <h2 class="pf-title">${escHtml(page.name)}</h2>
      </div>
      <div class="pf-roles">${roles}</div>
    </div>
    ${componentsHtml}
  `;
}

function renderComponent(item, config, appName) {
  const seed   = appName + (item.endpoint || item.title || item.type || '');
  const metric = deterministicMetric(seed);
  const change = deterministicChange(seed);
  const changeClass = change.startsWith('+') ? 'up' : 'down';
  const isWide = ['table','chart','list'].includes((item.type || '').toLowerCase());
  const cls    = isWide ? 'comp-card full-width' : 'comp-card';
  const type   = (item.type || 'card').toLowerCase();

  let body = '';

  if (type === 'metric' || type === 'kpi') {
    const label  = item.title || 'Records';
    const unit   = label.toLowerCase().includes('revenue') ? '$' :
                   label.toLowerCase().includes('rate')    ? '' : '';
    const numStr = label.toLowerCase().includes('rate') || label.toLowerCase().includes('%')
                   ? (deterministicMetric(seed, 1, 99) + '%')
                   : (unit + metric.toLocaleString());
    body = `
      <div class="metric-big">${numStr}</div>
      <div class="metric-sub ${changeClass}">${change}</div>
    `;
  } else if (type === 'chart') {
    const bars = Array.from({length:8}, (_,i) => {
      const h = deterministicMetric(seed+i, 20, 100);
      return `<div class="mini-bar" style="height:${h}%" title="${h}%"></div>`;
    }).join('');
    body = `<div class="mini-chart">${bars}</div><div class="metric-sub">${change}</div>`;
  } else if (type === 'table' || type === 'list') {
    const fields = (item.fields || ['Name', 'Status', 'Date']).slice(0, 4);
    const headerRow = fields.map(f => `<th>${escHtml(f)}</th>`).join('');
    const rows = Array.from({length:4}, (_, ri) => {
      const tds = fields.map((f, ci) => {
        const v = ci === 0
          ? ['Alice B.','Bob C.','Carol D.','David E.'][ri]
          : ci === fields.length - 1
            ? `<span class="cell-badge ${ri%3===0?'warn':'pass'}">${ri%3===0?'Pending':'Active'}</span>`
            : escHtml(String(deterministicMetric(seed+ri+ci, 10, 999)));
        return `<td>${v}</td>`;
      }).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    body = `<table class="mini-table"><thead><tr>${headerRow}</tr></thead><tbody>${rows}</tbody></table>`;
  } else if (type === 'form') {
    const fields = (item.fields || ['Name', 'Email']).slice(0, 4);
    body = fields.map(f => `
      <div class="mini-field">
        <label class="mini-field-label">${escHtml(f)}</label>
        <div class="mini-field-input">${f.toLowerCase().includes('email') ? 'user@example.com' : f.toLowerCase().includes('name') ? 'Enter nameâ€¦' : 'â€”'}</div>
      </div>
    `).join('');
  } else {
    body = `<div class="metric-big" style="font-size:1.3rem">${metric.toLocaleString()}</div>
            <div class="metric-sub">Total records</div>`;
  }

  const endpoint = item.endpoint
    ? `<div class="endpoint-tag">GET ${escHtml(item.endpoint)}</div>`
    : '';

  return `
    <div class="${cls}">
      <div class="comp-type-label">${type}</div>
      <div class="comp-card-title">${escHtml(item.title || item.type || 'Component')}</div>
      ${body}
      ${endpoint}
    </div>
  `;
}

function renderRuntimeChecks(runtime) {
  const el = document.getElementById('runtimeChecks');
  if (!el) return;
  const checks = runtime.checks || [];
  if (!checks.length) {
    el.innerHTML = '<p style="font-size:.78rem;color:var(--text-3);padding:12px 0">No checks recorded.</p>';
    return;
  }
  el.innerHTML = checks.map(c => `
    <div class="check-item">
      <div class="check-body">
        <div class="check-name">${escHtml(c.name || c.check)}</div>
        <div class="check-detail">${escHtml(c.detail || c.description || '')}</div>
      </div>
      <span class="check-pill ${c.passed ? 'pass' : 'fail'}">${c.passed ? 'PASS' : 'FAIL'}</span>
    </div>
  `).join('');
}

/* ================================================================
   JSON VIEW RENDERER
   ================================================================ */
function renderJson(config) {
  const el = document.getElementById('jsonOutput');
  if (!el) return;
  const raw = JSON.stringify(config, null, 2);
  el.innerHTML = syntaxHighlight(raw);

  const fn = document.getElementById('jsonFilename');
  if (fn) fn.textContent = `// ${(config.app?.name || 'app').toLowerCase().replace(/\s+/g,'-')}-config.json`;
}

function syntaxHighlight(json) {
  return json
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|true|false|null|-?\d+\.?\d*(?:[eE][+\-]?\d+)?)/g,
      match => {
        let cls = 'json-num';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'json-key' : 'json-str';
        } else if (/true|false/.test(match)) {
          cls = 'json-bool';
        } else if (match === 'null') {
          cls = 'json-null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
}

/* ================================================================
   COPY + DOWNLOAD JSON
   ================================================================ */
let _lastConfig = null;

document.getElementById('copyJson')?.addEventListener('click', async () => {
  if (!_lastConfig) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(_lastConfig, null, 2));
    const btn = document.getElementById('copyJson');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 2000); }
  } catch {/* silent */}
});

document.getElementById('downloadJson')?.addEventListener('click', () => {
  if (!_lastConfig) return;
  const blob = new Blob([JSON.stringify(_lastConfig, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: (_lastConfig.app?.name || 'forge44') + '-config.json'
  });
  a.click();
  URL.revokeObjectURL(url);
});

/* ================================================================
   VALIDATION RENDERER
   ================================================================ */
function renderValidation(result) {
  const el = document.getElementById('validationReport');
  if (!el) return;
  const v = result.validation;
  if (!v) { el.innerHTML = '<div class="validation-inner"><p>No validation data.</p></div>'; return; }

  const sumItems = [
    { label:'Tables',     value: v.summary?.tables     ?? 'â€”', cls: '' },
    { label:'Endpoints',  value: v.summary?.endpoints  ?? 'â€”', cls: '' },
    { label:'Pages',      value: v.summary?.pages      ?? 'â€”', cls: '' },
    { label:'Quality',    value: (v.qualityScore ?? 'â€”') + (v.qualityScore != null ? '%' : ''), cls: v.passed ? 'is-pass' : 'is-fail' },
  ];

  const summaryHtml = sumItems.map(s => `
    <div class="val-metric ${s.cls}">
      <div class="val-metric-label">${s.label}</div>
      <div class="val-metric-value">${s.value}</div>
    </div>
  `).join('');

  const issues = v.issues || [];
  const issuesHtml = issues.length
    ? issues.map(iss => {
        const sev = (iss.severity || 'note').toLowerCase();
        const sevLabel = iss.repaired ? 'repaired' : sev;
        return `
          <div class="issue-item ${sevLabel}-item">
            <div class="issue-body">
              <div class="issue-title">${escHtml(iss.layer || '')} â€” ${escHtml(iss.check || iss.rule || '')}</div>
              <div class="issue-msg">${escHtml(iss.message || '')}</div>
            </div>
            <span class="status-pill ${sevLabel}">${sevLabel.toUpperCase()}</span>
          </div>
        `;
      }).join('')
    : '<p style="font-size:.82rem;color:var(--text-3);padding:8px 0">No issues found â€” all contracts pass.</p>';

  el.innerHTML = `
    <div class="validation-inner">
      <div class="val-summary">${summaryHtml}</div>
      <div class="issue-list">${issuesHtml}</div>
      ${result.repair?.loops > 0 ? `
        <details style="margin-top:20px">
          <summary style="cursor:pointer;font-size:.8rem;font-weight:600;color:var(--repair)">
            â–¸ Repair log (${result.repair.loops} loop${result.repair.loops>1?'s':''})
          </summary>
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:5px">
            ${(result.repair.log||[]).map(l => `
              <div class="issue-item repair-item">
                <div class="issue-body">
                  <div class="issue-title">${escHtml(l.fix || '')}</div>
                  <div class="issue-msg">${escHtml(l.detail || '')}</div>
                </div>
                <span class="status-pill repair">REPAIRED</span>
              </div>
            `).join('')}
          </div>
        </details>
      ` : ''}
    </div>
  `;
}

/* ================================================================
   EVALUATION RUNNER
   ================================================================ */
document.getElementById('runEvaluation')?.addEventListener('click', () => {
  const confirmed = confirm(
    'Running the benchmark will make 20 real AI API calls and may take 2â€“5 minutes.\n\nProceed?'
  );
  if (confirmed) runEvaluation();
});

async function runEvaluation() {
  const btn = document.getElementById('runEvaluation');
  if (btn) { btn.disabled = true; btn.textContent = 'âŸ³ Runningâ€¦'; }
  const report = document.getElementById('evaluationReport');
  if (report) report.innerHTML = '<div class="empty-state"><div class="empty-icon">âŸ³</div><p class="empty-title">Running 20 promptsâ€¦</p></div>';

  const results = [];
  const t0 = performance.now();
  for (const prompt of evaluationPrompts) {
    const pt = performance.now();
    const r  = await compilePrompt(prompt);
    results.push({
      prompt,
      passed:  r.validation?.passed ?? false,
      quality: r.validation?.qualityScore ?? 0,
      repairs: r.repair?.loops ?? 0,
      ms:      Math.round(performance.now() - pt),
      pages:   r.runtime?.pages?.length ?? 0,
    });
  }
  const total   = Math.round(performance.now() - t0);
  const passing = results.filter(r => r.passed).length;
  const avgQ    = Math.round(results.reduce((s,r) => s+r.quality,0) / results.length);
  const totRep  = results.reduce((s,r) => s+r.repairs, 0);
  const avgMs   = Math.round(results.reduce((s,r) => s+r.ms, 0) / results.length);

  renderEvaluation(results, { total, passing, avgQ, totRep, avgMs });
  if (btn) { btn.disabled = false; btn.textContent = 'â–¶ Run 20 Prompts'; }
}

function renderEvaluation(rows, summary) {
  const el = document.getElementById('evaluationReport');
  if (!el) return;

  const passPct = Math.round((summary.passing / rows.length) * 100);
  const summaryHtml = [
    { label:'Pass Rate',       value:`${summary.passing}/${rows.length}`, cls:'is-pass' },
    { label:'Avg Quality',     value:`${summary.avgQ}%`,                  cls:'' },
    { label:'Total Repairs',   value:String(summary.totRep),              cls:'' },
    { label:'Avg Time',        value:`${summary.avgMs}ms`,                cls:'' },
  ].map(s => `
    <div class="val-metric ${s.cls}">
      <div class="val-metric-label">${s.label}</div>
      <div class="val-metric-value">${s.value}</div>
    </div>
  `).join('');

  const tableHtml = rows.map((r, i) => {
    const cat = i < 10 ? 'Real' : 'Edge';
    return `
      <div class="eval-row">
        <span class="status-pill ${r.passed?'pass':'fail'}" style="flex-shrink:0">
          ${r.passed ? 'PASS' : 'FAIL'}
        </span>
        <span class="eval-row-prompt" title="${escHtml(r.prompt)}">${escHtml(r.prompt.slice(0,72))}â€¦</span>
        <div class="eval-row-meta">
          <span class="eval-meta-chip">${cat}</span>
          <span class="eval-meta-chip">${r.quality}%</span>
          <span class="eval-meta-chip">${r.ms}ms</span>
          <span class="eval-meta-chip">${r.pages}pg</span>
        </div>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <div class="eval-summary">${summaryHtml}</div>
    <div class="success-bar-wrap" style="margin-bottom:16px">
      <div style="font-size:.72rem;color:var(--text-3);margin-bottom:6px;font-weight:600">
        ${passPct}% success rate across 20 prompts
      </div>
      <div class="success-bar-track">
        <div class="success-bar-fill" style="width:${passPct}%"></div>
      </div>
    </div>
    <div class="eval-table">${tableHtml}</div>
    <p style="font-size:.72rem;color:var(--text-3);margin-top:14px">
      Total benchmark time: ${summary.total}ms
    </p>
  `;
}

/* ================================================================
   MASTER RENDER
   ================================================================ */
function renderAll(result) {
  _lastConfig = result.config;
  revealSections();
  updateAiBadges(result);
  updateStats(result);
  renderPipeline(result.stages || []);
  renderRuntime(result.runtime, result.config);
  renderJson(result.config);
  renderValidation(result);
  // Scroll AI section into view
  setTimeout(() => {
    document.getElementById('aiSection')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }, 200);
}

/* ================================================================
   MAIN COMPILE TRIGGER
   ================================================================ */
document.getElementById('generateBtn')?.addEventListener('click', compile);
document.getElementById('promptInput')?.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') compile();
});

async function compile() {
  const ta     = document.getElementById('promptInput');
  const prompt = (ta?.value || '').trim();
  if (!prompt) {
    ta?.focus();
    ta?.classList.add('error-shake');
    setTimeout(() => ta?.classList.remove('error-shake'), 600);
    return;
  }
  hideCompileError();
  setLoading(true);
  clearAiLog();
  startAiLog(prompt);
  try {
    const result = await compilePrompt(prompt);
    renderAll(result);
    await showAiSteps(result);
  } catch (err) {
    console.error('[compile] Error:', err.status ?? 0, err.message);
    showCompileError(err.message || 'Compilation failed. Please try again.');
  } finally {
    setLoading(false);
  }
}

/* ================================================================
   UTILITY
   ================================================================ */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function pageIcon(name) {
  const n = name.toLowerCase();
  if (n.includes('dashboard')  || n.includes('home'))      return 'âŠž';
  if (n.includes('user')       || n.includes('people'))    return 'ðŸ‘¤';
  if (n.includes('contact'))                               return 'ðŸ“‹';
  if (n.includes('analytic')   || n.includes('report'))   return 'ðŸ“Š';
  if (n.includes('setting'))                               return 'âš™';
  if (n.includes('payment')    || n.includes('billing'))  return 'ðŸ’³';
  if (n.includes('product')    || n.includes('catalog'))  return 'ðŸ“¦';
  if (n.includes('order'))                                 return 'ðŸ›’';
  if (n.includes('login')      || n.includes('auth'))     return 'ðŸ”‘';
  if (n.includes('admin'))                                 return 'ðŸ›¡';
  if (n.includes('message')    || n.includes('chat'))     return 'ðŸ’¬';
  if (n.includes('notification'))                         return 'ðŸ””';
  if (n.includes('profile'))                               return 'ðŸªª';
  return 'â–¸';
}

/* ================================================================
   AUTH TOKEN HELPER
   Retrieves the current user's Firebase ID token to send with API
   requests. Authenticated users receive higher rate limits on the
   backend. This function always resolves (never throws).
   ================================================================ */

/**
 * @returns {Promise<object>} Authorization header object, or {} if not signed in
 */
async function getAuthHeaders() {
  try {
    const user = window.__forge44User;
    if (!user || typeof user.getIdToken !== 'function') return {};
    const token = await user.getIdToken(/* forceRefresh */ false);
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  } catch {
    // Token retrieval failed (network, revoked, etc.) — compile as anonymous
    return {};
  }
}

/* ================================================================
   COMPILE API CLIENT
   ================================================================ */

/**
 * Compile a prompt by sending it to the Forge44 backend API.
 * The backend runs all pipeline stages (including the real LLM call)
 * and returns a validated result object ready for renderAll().
 *
 * Error codes surface user-friendly messages in the UI via showCompileError().
 *
 * @param   {string}  prompt  User's application description
 * @returns {Promise<object>} Pipeline result (intent, config, validation, runtime, ...)
 */
async function compilePrompt(prompt) {
  // Prevent accidental direct-file-open invocations
  if (window.location.protocol === 'file:') {
    throw new Error(
      'Compilation requires a server. ' +
      'Deploy to Vercel or run: npx vercel dev'
    );
  }

  const COMPILE_URL = '/api/compile';
  const TIMEOUT_MS  = 30_000;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Include Firebase ID token if the user is signed in.
    // The backend uses this to grant authenticated users higher rate limits.
    // Falls back to {} (empty) if the user is not signed in or token retrieval fails.
    const authHeaders = await getAuthHeaders();

    const response = await fetch(COMPILE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body:    JSON.stringify({ prompt, planMode }),
      signal:  controller.signal,
    });

    clearTimeout(timeoutId);

    // Always parse JSON body â€” the API returns JSON for both success and errors
    let data;
    try {
      data = await response.json();
    } catch {
      const e  = new Error('Server returned a non-JSON response. Please try again.');
      e.status = response.status;
      throw e;
    }

    if (!response.ok) {
      const e  = new Error(data.message || `Server error (HTTP ${response.status})`);
      e.status = response.status;
      e.code   = response.status === 429 ? 'RATE_LIMITED'
               : response.status === 504 ? 'TIMEOUT'
               : response.status === 503 ? 'SERVICE_UNAVAILABLE'
               : response.status >= 500  ? 'SERVER_ERROR'
               : 'CLIENT_ERROR';
      throw e;
    }

    if (!data.result) {
      throw new Error('The server returned no result. Please try again.');
    }

    return data.result;

  } catch (err) {
    clearTimeout(timeoutId);

    // AbortController fired the request timeout
    if (err.name === 'AbortError') {
      const e  = new Error('Request timed out after 30 seconds. Please try again.');
      e.status = 504;
      e.code   = 'TIMEOUT';
      throw e;
    }

    // Network failure (offline, DNS error, etc.)
    if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
      const e  = new Error('Network error. Please check your connection and try again.');
      e.status = 0;
      e.code   = 'NETWORK_ERROR';
      throw e;
    }

    throw err;
  }
}

/* ================================================================
   COMPILE ERROR DISPLAY
   ================================================================ */

/**
 * Show a dismissible error bar below the prompt box.
 * Auto-dismisses after 8 seconds.
 *
 * @param {string} message  User-facing error message
 */
function showCompileError(message) {
  const el  = document.getElementById('compileError');
  const msg = document.getElementById('compileErrorMsg');
  if (!el || !msg) {
    // Fallback: console only (element not in DOM)
    console.warn('[showCompileError]', message);
    return;
  }
  msg.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(showCompileError._timer);
  showCompileError._timer = setTimeout(hideCompileError, 8000);
}
showCompileError._timer = null;

function hideCompileError() {
  clearTimeout(showCompileError._timer);
  document.getElementById('compileError')?.classList.add('hidden');
}

// Dismiss on close button
document.getElementById('compileErrorClose')?.addEventListener('click', hideCompileError);

// Dismiss when user re-focuses the prompt (signals they want to try again)
document.getElementById('promptInput')?.addEventListener('focus', () => {
  const el = document.getElementById('compileError');
  if (el && !el.classList.contains('hidden')) hideCompileError();
});


/* ================================================================
   SCROLLYTELLING INTERSECTION LOGIC
   ================================================================ */
window.addEventListener('scroll', () => {
  const cards = document.querySelectorAll('.scrolly-card');
  if (!cards.length) return;
  
  let activeIndex = 0;
  cards.forEach((card, idx) => {
    const rect = card.getBoundingClientRect();
    if (rect.top <= 20) {
      activeIndex = idx;
    }
  });

  // Fade the background gradients
  document.querySelectorAll('.scrolly-bg').forEach((bg, idx) => {
    bg.classList.toggle('active', idx === activeIndex);
  });
});

// Use IntersectionObserver to trigger the fade up animation when cards enter the viewport
const scrollyObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
    }
  });
}, { threshold: 0.15 });

document.querySelectorAll('.scrolly-card').forEach(card => {
  scrollyObserver.observe(card);
});

/* ================================================================
   MOBILE MENU TOGGLE
   ================================================================ */
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const navLinks = document.getElementById('navLinks');
if (mobileMenuBtn && navLinks) {
  mobileMenuBtn.addEventListener('click', () => {
    const isExpanded = mobileMenuBtn.getAttribute('aria-expanded') === 'true';
    mobileMenuBtn.setAttribute('aria-expanded', !isExpanded);
    navLinks.classList.toggle('show-mobile');
    
    // Toggle icons
    const openIcon = mobileMenuBtn.querySelector('.menu-icon-open');
    const closeIcon = mobileMenuBtn.querySelector('.menu-icon-close');
    if (openIcon && closeIcon) {
      openIcon.classList.toggle('hidden');
      closeIcon.classList.toggle('hidden');
    }
  });
}

/* ================================================================
   BOTTOM CTA SCROLL
   ================================================================ */
const bottomCtaBtn = document.getElementById('bottomCtaBtn');
if (bottomCtaBtn) {
  bottomCtaBtn.addEventListener('click', () => {
    const promptInput = document.getElementById('promptInput');
    if (promptInput) {
      promptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => promptInput.focus(), 400);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}
