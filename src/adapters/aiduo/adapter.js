// ========== 爱多分阅卷适配器 ==========
// 平台：爱多分（eiduo.com / xuebanyun.com），阅卷界面一般在 ui.eiduo.com
// 技术栈：Angular exam-webapp。路由 marking/index（正评）与 marking/check-index（抽查/回评）。
//
// URL：脚本头 match 覆盖「主机 + 任意路径前缀 + exam-webapp/marking」。
// hash 路由 match 看不到，由 include 正则匹配整段地址（pathname + hash）。
// shouldInitialize / isMarkingPage 用同一条边界，不在登录页或整站其它页面注册。
//
// 填分安全：
// - 抽查/回评（check-index、check=true、回评状态条）和批量打分拒绝填分、拒绝提交。
// - 写入输入框会触发平台「输入即提交」计时（约 0.4–6 秒）。填分期间清掉这段计时，
//   只允许 submitGrade 点击「提交分数」。
// - 输入框与 Angular 阅卷模型必须一致，否则显式失败，避免把旧分交上去。
// - 「提交分数」是表单按钮。Angular 的 ngSubmit 在 click 冒泡之后才调用 submit，
//   放行必须盖住这一段，不能在 click 冒泡里关掉。
// - 换卷优先认当前答卷的 taskId / studentId。考试和科目不变，不能拿来当答卷身份。
//   读不到身份时，才看可见答题图的路径；签名、裁切参数和藏起来的旧图都不算换卷。

const AIDUO_TASK_KEYS = ['examId', 'subjectId', 'isArbitrate', 'check'];
const AIDUO_DEBOUNCE_MIN_MS = 400;
const AIDUO_DEBOUNCE_MAX_MS = 6000;

function aiduoHostOk(hostname) {
    const host = String(hostname || '').trim().toLowerCase().replace(/\.+$/, '');
    if (!host) return false;
    return host === 'eiduo.com' || host.endsWith('.eiduo.com')
        || host === 'xuebanyun.com' || host.endsWith('.xuebanyun.com');
}

function aiduoRouteOk(pathname, hash) {
    const blob = String(pathname || '') + String(hash || '');
    return /\/exam-webapp\/marking(?:\/|[?#]|$)/i.test(blob);
}

function aiduoRegradeLocation(loc) {
    const blob = String(loc.pathname || '') + String(loc.hash || '');
    if (/\/exam-webapp\/marking\/check-index(?:\/|[?#]|$)/i.test(blob)) return true;
    const bags = [];
    try {
        bags.push(new URLSearchParams(String(loc.search || '').replace(/^\?/, '')));
    } catch (e) { /* 查询串损坏时不当成回评 */ }
    try {
        bags.push(new URLSearchParams(String(loc.hash || '').split('?')[1] || ''));
    } catch (e) { /* hash 查询损坏时忽略 */ }
    return bags.some((params) => params.get('check') === 'true');
}

function aiduoNormalizeImageUrl(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) return '';
    try {
        const url = new URL(trimmed, 'https://ui.eiduo.com');
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        if (/\/assets\/|help-center|favicon/i.test(url.pathname)) return '';
        return url.origin + url.pathname;
    } catch (e) {
        const bare = trimmed.split('#')[0].split('?')[0];
        if (!bare || /\/assets\/|help-center|favicon/i.test(bare)) return '';
        return bare;
    }
}

function aiduoSameScore(expected, actual) {
    if (expected == null || !Number.isFinite(Number(expected))) return false;
    const text = actual == null ? '' : String(actual).trim();
    if (text === '') return false;
    const parsed = Number(text);
    return Number.isFinite(parsed) && Math.abs(parsed - Number(expected)) < 1e-6;
}

function aiduoMaxScore(placeholder, maxAttr) {
    const matched = String(placeholder || '').match(/满分\s*(\d+(?:\.\d+)?)/);
    if (matched) {
        const fromLabel = parseFloat(matched[1]);
        if (Number.isFinite(fromLabel) && fromLabel > 0) return fromLabel;
    }
    if (maxAttr != null && String(maxAttr).trim() !== '') {
        const fromAttr = parseFloat(maxAttr);
        if (Number.isFinite(fromAttr) && fromAttr > 0) return fromAttr;
    }
    return 0;
}

function aiduoIsScoreInput(el) {
    if (!el || el.disabled || el.type === 'hidden') return false;
    const id = String(el.id || '').toLowerCase();
    if (id === 'row' || id === 'column') return false;
    const placeholder = el.getAttribute ? (el.getAttribute('placeholder') || '') : '';
    if (placeholder.indexOf('评语') !== -1) return false;
    if (placeholder.indexOf('满分') === 0) return true;
    const maxAttr = el.getAttribute ? el.getAttribute('max') : null;
    if (maxAttr == null || String(maxAttr).trim() === '') return false;
    const maxScore = parseFloat(maxAttr);
    return Number.isFinite(maxScore) && maxScore > 0;
}

function aiduoImageVisible(img) {
    let node = img;
    while (node) {
        if (node.hidden) return false;
        const style = node.style || {};
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        node = node.parentElement;
    }
    return !!img;
}

function aiduoInputLabel(el, index) {
    const item = el.closest ? el.closest('.item') : null;
    const titled = item && item.querySelector ? item.querySelector('[title]') : null;
    let label = titled ? (titled.getAttribute('title') || titled.textContent || '') : '';
    label = String(label).trim();
    if (!label && item) {
        const step = String(item.textContent || '').match(/第\s*\d+\s*步/);
        if (step) label = step[0].replace(/\s/g, '');
    }
    return label || ('评分' + (index + 1));
}

function aiduoReadParams(search) {
    try {
        return new URLSearchParams(String(search || '').replace(/^\?/, ''));
    } catch (e) {
        return new URLSearchParams();
    }
}

const AiduoAdapter = {
    name: '爱多分阅卷',
    id: 'aiduo',
    // 与 build.js 脚本头 match 保持一致。hash 路由另由 include 正则覆盖。
    urlPatterns: [
        '*://*.eiduo.com/*exam-webapp/marking/*',
        '*://eiduo.com/*exam-webapp/marking/*',
        '*://*.xuebanyun.com/*exam-webapp/marking/*',
        '*://xuebanyun.com/*exam-webapp/marking/*',
    ],
    iconUrl: 'https://www.eiduo.com/container/favicon-eiduo.ico',
    // 普通模式和试改等教师确认。无人值守仍走核心的短倒计时。
    requiresManualConfirm: true,

    _expectedScores: null,
    _baselinePaperKey: '',
    _allowPlatformSubmit: false,
    _holdActive: false,
    _holdGeneration: 0,
    _heldComponent: null,
    _timerGuard: false,

    shouldInitialize() {
        try {
            return aiduoHostOk(window.location.hostname)
                && aiduoRouteOk(window.location.pathname, window.location.hash);
        } catch (e) {
            return false;
        }
    },

    isMarkingPage() {
        try {
            return aiduoRouteOk(window.location.pathname, window.location.hash);
        } catch (e) {
            return false;
        }
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[爱多分] 当前不是阅卷页', window.location.pathname, window.location.hash);
            return false;
        }
        if (this.isRegradeMode()) {
            console.warn('[爱多分] 抽查或回评中，不进入自动批改');
            return false;
        }
        if (this._isBatchMode()) {
            console.warn('[爱多分] 批量打分开启中，不进入自动批改（一份分会打到多张卡）');
            return false;
        }
        try {
            if (typeof waitForElement === 'function') {
                await waitForElement(AIDUO_SELECTORS.SCORE_INPUT, 12000).catch(() => null);
            }
            if (this.isRegradeMode() || this._isBatchMode()) return false;
            const inputs = this.getScoreInputs();
            const button = this._submitButton();
            const detected = inputs.length > 0 && !!button;
            console.log('[爱多分] 检测 分数框=' + inputs.length + ' 提交=' + !!button + ' => ' + detected);
            return detected;
        } catch (e) {
            console.error('[爱多分] detectMarkingPage 异常:', e);
            return false;
        }
    },

    getTaskIdentifier() {
        const path = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
        const hash = String(window.location.hash || '');
        const hashPath = hash.split('?')[0];
        const searchParams = aiduoReadParams(window.location.search);
        const hashParams = aiduoReadParams(hash.split('?')[1] || '');
        const parts = [];
        AIDUO_TASK_KEYS.forEach((key) => {
            const value = searchParams.get(key) || hashParams.get(key);
            if (value) parts.push(key + '=' + value);
        });
        const base = hashPath ? path + hashPath : path;
        return parts.length ? base + '?' + parts.join('&') : base;
    },

    // 一份答卷的身份。taskId 每份任务一换，studentId 每生一换。
    // examId / subjectId 整场不变，不能放进这里。
    getPaperIdentity() {
        try {
            return this._readPaperKey() || null;
        } catch (e) {
            return null;
        }
    },

    async gatherAnswerImages() {
        const budgetRaw = Number(window.__AI_MARKER_AIDUO_GATHER_MS__);
        const budget = (Number.isFinite(budgetRaw) && budgetRaw > 0) ? budgetRaw : 10000;
        const step = Math.max(20, Math.min(250, Math.floor(budget / 4)));
        const deadline = Date.now() + budget;
        let previous = '';
        let hits = 0;
        while (Date.now() < deadline) {
            const urls = this._answerUrls();
            const signature = urls.map(aiduoNormalizeImageUrl).filter(Boolean).join('|');
            if (signature) {
                if (signature === previous) hits += 1;
                else { previous = signature; hits = 1; }
                if (hits >= 2) {
                    const stable = urls.filter((url) => aiduoNormalizeImageUrl(url));
                    console.log('[爱多分] 取图 ' + stable.length + ' 张');
                    return stable;
                }
            } else {
                previous = '';
                hits = 0;
            }
            if (Date.now() + step >= deadline) break;
            await new Promise((resolve) => setTimeout(resolve, step));
        }
        console.warn('[爱多分] 答题图不稳定或没有取到，返回空数组（宁可不批，也不拿上一份的图）');
        return [];
    },

    async fetchImageAsBase64(url) {
        if (typeof url === 'string' && url.startsWith('data:')) {
            const comma = url.indexOf(',');
            return comma >= 0 ? url.slice(comma + 1) : '';
        }
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const nodes = Array.from(document.querySelectorAll(AIDUO_SELECTORS.SCORE_INPUT));
        const inputs = [];
        nodes.forEach((el) => {
            if (!aiduoIsScoreInput(el)) return;
            const placeholder = el.getAttribute ? (el.getAttribute('placeholder') || '') : '';
            inputs.push({
                element: el,
                label: aiduoInputLabel(el, inputs.length),
                index: inputs.length,
                maxScore: aiduoMaxScore(placeholder, el.getAttribute ? el.getAttribute('max') : null),
            });
        });
        return inputs;
    },

    fillScores(scores) {
        this._expectedScores = null;
        if (!Array.isArray(scores) || scores.length === 0) return false;
        if (this.isRegradeMode()) {
            console.warn('[爱多分] 抽查或回评中，拒绝填分');
            return false;
        }
        if (this._isBatchMode()) {
            console.warn('[爱多分] 批量打分中，拒绝填分');
            return false;
        }
        for (let i = 0; i < scores.length; i++) {
            const score = Number(scores[i]);
            if (!Number.isFinite(score) || score < 0) {
                console.warn('[爱多分] 第 ' + (i + 1) + ' 个分数不是非负有限数字，拒绝填分');
                return false;
            }
        }
        const inputs = this.getScoreInputs();
        if (inputs.length !== scores.length) {
            console.warn('[爱多分] 分数个数 ' + scores.length + ' 与分数框 ' + inputs.length + ' 不一致，拒绝填分');
            return false;
        }
        for (let i = 0; i < scores.length; i++) {
            if (inputs[i].maxScore > 0 && Number(scores[i]) > inputs[i].maxScore) {
                console.warn('[爱多分] 第 ' + (i + 1) + ' 个分数超过满分 ' + inputs[i].maxScore + '，拒绝填分');
                return false;
            }
        }
        const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (!descriptor || typeof descriptor.set !== 'function') {
            console.warn('[爱多分] 无法写入输入框');
            return false;
        }
        try {
            this._withoutDebouncedSubmit(() => {
                for (let i = 0; i < scores.length; i++) {
                    const el = inputs[i].element;
                    descriptor.set.call(el, String(scores[i]));
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        } catch (e) {
            // 输入事件可能已经排上「输入即提交」。失败也要按住，不能让平台自己交卷。
            this._armSubmitHold();
            console.warn('[爱多分] 填分过程异常，拒绝提交', e);
            return false;
        }
        this._armSubmitHold();
        if (this.isRegradeMode() || this._isBatchMode()) {
            console.warn('[爱多分] 填分后进入抽查或批量打分，拒绝继续');
            return false;
        }
        const written = this.getScoreInputs();
        if (written.length !== scores.length) {
            console.warn('[爱多分] 填分后分数框数量变了，拒绝继续');
            return false;
        }
        for (let i = 0; i < scores.length; i++) {
            const el = written[i].element;
            if (!aiduoSameScore(scores[i], el.value) || (el.classList && el.classList.contains('ng-invalid'))) {
                console.warn('[爱多分] 第 ' + (i + 1) + ' 个分数未落稳（值=' + el.value + '），拒绝提交');
                return false;
            }
        }
        const model = this._modelScores(this._submitComponent());
        if (!model) {
            console.warn('[爱多分] 读不到阅卷模型，拒绝填分（避免把旧分交上去）');
            return false;
        }
        if (model.length !== scores.length) {
            console.warn('[爱多分] 模型分数 ' + model.length + ' 与待填 ' + scores.length + ' 不一致，拒绝提交');
            return false;
        }
        for (let i = 0; i < scores.length; i++) {
            if (!aiduoSameScore(scores[i], model[i])) {
                console.warn('[爱多分] 第 ' + (i + 1) + ' 个分数没有写进阅卷模型（模型=' + model[i] + '），拒绝提交');
                return false;
            }
        }
        this._expectedScores = scores.map((score) => Number(score));
        console.log('[爱多分] 已填入分数', this._expectedScores.join(','));
        return true;
    },

    submitGrade() {
        if (this.isRegradeMode()) {
            console.warn('[爱多分] 抽查或回评中，拒绝提交');
            return false;
        }
        if (this._isBatchMode()) {
            console.warn('[爱多分] 批量打分中，拒绝提交');
            return false;
        }
        const expected = this._expectedScores;
        const inputs = this.getScoreInputs();
        if (!expected || expected.length === 0 || inputs.length !== expected.length) {
            console.warn('[爱多分] 没有可核对的已填分数，拒绝提交');
            return false;
        }
        for (let i = 0; i < expected.length; i++) {
            const el = inputs[i].element;
            if (!aiduoSameScore(expected[i], el.value) || (el.classList && el.classList.contains('ng-invalid'))) {
                console.warn('[爱多分] 提交前第 ' + (i + 1) + ' 个分数框不可用，拒绝点击提交');
                return false;
            }
        }
        const model = this._modelScores(this._submitComponent());
        if (!model || model.length !== expected.length) {
            console.warn('[爱多分] 提交前读不到阅卷模型，拒绝点击');
            return false;
        }
        for (let i = 0; i < expected.length; i++) {
            if (!aiduoSameScore(expected[i], model[i])) {
                console.warn('[爱多分] 提交前模型分数与待提交不一致，拒绝点击');
                return false;
            }
        }
        this._cancelDebouncedSubmit();
        const button = this._submitButton();
        if (!button) {
            console.warn('[爱多分] 未找到「提交分数」按钮');
            return false;
        }
        if (button.disabled || button.getAttribute('disabled') !== null) {
            console.warn('[爱多分] 「提交分数」按钮不可用');
            return false;
        }
        // 先记下这份答卷。平台的换卷请求回来时，图可能已经换成 blob，或路径只改了裁切参数。
        this._baselinePaperKey = this._readPaperKey();
        // ngSubmit 在 click() 里面、click 冒泡结束之后同步发生。放行要盖住整个 click()。
        this._allowPlatformSubmit = true;
        try {
            button.click();
        } finally {
            this._allowPlatformSubmit = false;
            this._removeTimerGuard();
        }
        console.log('[爱多分] 已点击「提交分数」');
        try {
            if (typeof AiduoProgress !== 'undefined' && AiduoProgress && typeof AiduoProgress.noteSubmitted === 'function') {
                AiduoProgress.noteSubmitted();
            }
        } catch (e) {
            console.warn('[爱多分] 进度监视失败', e);
        }
        return true;
    },

    async waitForNextPaper(oldImageUrl) {
        const baselineKey = this._baselinePaperKey || '';
        const baselineImg = aiduoNormalizeImageUrl(oldImageUrl);
        if (!baselineKey && !baselineImg) {
            console.warn('[爱多分] 没有基准答卷，不能判断是否换卷');
            return false;
        }
        const win = Number(window.__AI_MARKER_WAIT_WINDOW_MS__);
        const windowMs = (Number.isFinite(win) && win > 0) ? win : 25000;
        const tick = Math.max(40, Math.min(300, Math.floor(windowMs / 8)));
        const deadline = Date.now() + windowMs;
        let candidate = '';
        let hits = 0;
        while (true) {
            const key = this._readPaperKey();
            let sig = '';
            if (baselineKey && key && key !== baselineKey) {
                sig = 'id:' + key;
            } else if (!(baselineKey && key && key === baselineKey) && this._imageAdvanced(baselineImg)) {
                const urls = this._answerUrls().map(aiduoNormalizeImageUrl).filter(Boolean);
                sig = 'img:' + urls.join('|');
            }
            if (sig) {
                if (sig === candidate) hits += 1;
                else { candidate = sig; hits = 1; }
                if (hits >= 2) {
                    this._baselinePaperKey = '';
                    this._releaseSubmitHold();
                    this._expectedScores = null;
                    console.log('[爱多分] 换卷（' + (sig.indexOf('id:') === 0 ? '任务已切换' : '答题图已切换') + '）');
                    return true;
                }
            } else {
                candidate = '';
                hits = 0;
            }
            if (Date.now() >= deadline) {
                console.warn('[爱多分] 等待下一份超时（未把空分数框或同一任务的裁切抖动当成换卷）');
                return false;
            }
            await new Promise((resolve) => setTimeout(resolve, tick));
        }
    },

    isRegradeMode() {
        try {
            if (aiduoRegradeLocation(window.location)) return true;
        } catch (e) { /* 地址损坏时再看界面 */ }
        return !!document.querySelector(AIDUO_SELECTORS.REGRADE_STATUS);
    },

    onPageLoad() {
        console.log('[爱多分] 页面加载完成', window.location.hostname, window.location.pathname, window.location.hash);
        this._pauseIfUnsafe();
    },

    // 本份答卷送给 AI 时开始扫描。出分、失败、暂停、离开都收起。
    // 收起扫描线不放开平台提交：1.21.18.7 的确认按住仍然有效。
    onGradingStart() {
        try { AiduoScanLine.start(); } catch (e) { console.warn('[爱多分] 扫描线启动失败', e); }
    },

    onScoresReady() {
        try { AiduoScanLine.stop(); } catch (e) { console.warn('[爱多分] 扫描线停止失败', e); }
    },

    onGradingEnd() {
        try { AiduoScanLine.stop(); } catch (e) { console.warn('[爱多分] 扫描线停止失败', e); }
        try {
            if (typeof AiduoProgress !== 'undefined' && AiduoProgress) AiduoProgress.stop();
        } catch (e) { console.warn('[爱多分] 进度监视停止失败', e); }
    },

    _pauseIfUnsafe() {
        const regrade = this.isRegradeMode();
        const batch = this._isBatchMode();
        if (!regrade && !batch) return;
        const state = window.aiGradingState;
        if (!state || !state.isRunning) return;
        state.isRunning = false;
        state.isPaused = true;
        state.errorRetryCount = 0;
        if (state.abortController) {
            try { state.abortController.abort(); } catch (e) { /* 中断失败不影响暂停 */ }
        }
        const dialog = document.getElementById('auto-submit-dialog');
        if (dialog) {
            if (dialog.countdownTimer) clearInterval(dialog.countdownTimer);
            if (typeof dialog.remove === 'function') dialog.remove();
        }
        try {
            sessionStorage.removeItem('ai-grading-auto-resume');
            sessionStorage.removeItem('ai-grading-retry-count');
        } catch (e) { /* 隐私模式可能禁掉 sessionStorage */ }
        const button = document.querySelector('.ai-grade-btn');
        if (button) {
            button.textContent = '继续批改';
            if (button.classList) {
                button.classList.remove('running', 'unattended', 'trial');
                button.classList.add('paused');
            }
        }
        console.warn('[爱多分] ' + (regrade ? '进入抽查或回评' : '批量打分已开启') + '，已暂停自动批改');
    },

    _answerImages() {
        return Array.from(document.querySelectorAll(AIDUO_SELECTORS.ANSWER_IMAGE))
            .filter((img) => aiduoImageVisible(img) && aiduoNormalizeImageUrl(img && img.src));
    },

    _imageAdvanced(baselineImg) {
        if (!baselineImg) return false;
        const images = this._answerImages();
        const urls = images.map((img) => aiduoNormalizeImageUrl(img && img.src)).filter(Boolean);
        if (!urls.length || urls.indexOf(baselineImg) !== -1) return false;
        return images.some((img) => img && img.naturalWidth > 0);
    },

    _readPaperKey() {
        try {
            const nodes = [];
            const index = document.querySelector(AIDUO_SELECTORS.EXAM_INDEX);
            const submit = document.querySelector(AIDUO_SELECTORS.SUBMIT_ROOT);
            if (index) nodes.push(index);
            if (submit) nodes.push(submit);
            for (let i = 0; i < nodes.length; i++) {
                const key = this._keyFromContext(nodes[i].__ngContext__);
                if (key) return key;
            }
        } catch (e) { /* 身份读不到就退回图片 */ }
        return '';
    },

    _keyFromContext(ctx) {
        const direct = this._keyFromBlock(ctx && ctx.topicBlockInfo);
        if (direct) return direct;
        const list = this._contextList(ctx);
        if (!list) return '';
        for (let i = 0; i < list.length; i++) {
            const node = list[i];
            if (!node || typeof node !== 'object') continue;
            const key = this._keyFromBlock(node.topicBlockInfo);
            if (key) return key;
        }
        return '';
    },

    _keyFromBlock(block) {
        if (!block || typeof block !== 'object') return '';
        const task = block.taskInfo;
        const base = block.baseInfo;
        const taskId = task && task.taskId != null && String(task.taskId) !== '' ? String(task.taskId) : '';
        let studentId = '';
        if (base && typeof base === 'object' && !Array.isArray(base)
            && base.studentId != null && String(base.studentId) !== '') {
            studentId = String(base.studentId);
        }
        if (!taskId && !studentId) return '';
        return 'task=' + taskId + '&student=' + studentId;
    },

    _answerUrls() {
        return this._answerImages().map((img) => img.src);
    },

    _submitButton() {
        const root = document.querySelector(AIDUO_SELECTORS.SUBMIT_ROOT);
        if (!root || typeof root.querySelectorAll !== 'function') return null;
        const buttons = root.querySelectorAll('button');
        for (let i = 0; i < buttons.length; i++) {
            const text = String(buttons[i].textContent || '').replace(/\s/g, '');
            if (text.indexOf('提交分数') !== -1) return buttons[i];
        }
        return null;
    },

    _isBatchMode() {
        if (document.querySelector(AIDUO_SELECTORS.BATCH_FLAG)) return true;
        const component = this._submitComponent();
        if (component && component.isMultScore === true) return true;
        return this._pageMultScore();
    },

    _pageMultScore() {
        const root = document.querySelector(AIDUO_SELECTORS.EXAM_INDEX);
        const list = this._contextList(root && root.__ngContext__);
        if (!list) return false;
        for (let i = 0; i < list.length; i++) {
            const node = list[i];
            if (node && node.isMultScore === true && typeof node.multTopic === 'function') return true;
        }
        return false;
    },

    _contextList(ctx) {
        if (Array.isArray(ctx)) return ctx;
        if (ctx && Array.isArray(ctx.lView)) return ctx.lView;
        return null;
    },

    _submitComponent() {
        const root = document.querySelector(AIDUO_SELECTORS.SUBMIT_ROOT);
        if (!root) return null;
        const direct = this._findSubmitVm(root.__ngContext__);
        if (direct) return direct;
        const form = typeof root.querySelector === 'function' ? root.querySelector('form') : null;
        return form ? this._findSubmitVm(form.__ngContext__) : null;
    },

    _findSubmitVm(ctx) {
        const list = this._contextList(ctx);
        if (!list) return null;
        for (let i = 0; i < list.length; i++) {
            const node = list[i];
            if (node && typeof node.debounceSubmit === 'function'
                && typeof node.submit === 'function'
                && Array.isArray(node.data)) return node;
        }
        return null;
    },

    _modelScores(component) {
        if (!component || !Array.isArray(component.data)) return null;
        const scores = [];
        component.data.forEach((item) => {
            if (!item || item.specialType === 1 || item.specialType === 2) return;
            if (item.markingSteps && item.markingSteps.length) {
                item.markingSteps.forEach((step) => scores.push(step ? step.score : null));
            } else {
                scores.push(item.score);
            }
        });
        return scores;
    },

    _cancelDebouncedSubmit() {
        const component = this._heldComponent || this._submitComponent();
        if (!component || component.timeoutId == null) return;
        try { clearTimeout(component.timeoutId); } catch (e) { /* 计时器可能已被清掉 */ }
        component.timeoutId = null;
    },

    // 填分后按住平台提交，直到教师确认、下一份出现，或 debounce 窗口结束。
    // Angular 经常在填分函数返回之后才排 debounceSubmit（微任务或 setTimeout(0)）。
    _armSubmitHold() {
        this._holdActive = true;
        this._allowPlatformSubmit = false;
        const generation = ++this._holdGeneration;
        const component = this._submitComponent();
        if (component) this._wrapComponent(component);
        this._hookSubmitButton();
        const nativeSet = this._timerNativeSet || window.setTimeout;
        this._installTimerGuard();
        this._cancelDebouncedSubmit();
        const releaseTimer = nativeSet(() => {
            if (this._holdGeneration === generation) this._releaseSubmitHold();
        }, 7000);
        if (releaseTimer && typeof releaseTimer.unref === 'function') releaseTimer.unref();
    },

    _releaseSubmitHold() {
        this._holdActive = false;
        this._allowPlatformSubmit = false;
        this._removeTimerGuard();
        this._unwrapComponent();
        this._cancelDebouncedSubmit();
    },

    _wrapComponent(component) {
        if (this._heldComponent && this._heldComponent !== component) this._unwrapComponent();
        if (!component || typeof component.submit !== 'function') return;
        if (component.__aiduoWrapped) {
            this._heldComponent = component;
            return;
        }
        const adapter = this;
        const originalSubmit = component.submit;
        const originalDebounce = component.debounceSubmit;
        component.__aiduoOriginalSubmit = originalSubmit;
        component.__aiduoOriginalDebounce = originalDebounce;
        component.submit = function aiduoGuardedSubmit() {
            if (!adapter._allowPlatformSubmit) {
                adapter._cancelDebouncedSubmit();
                return;
            }
            return originalSubmit.apply(this, arguments);
        };
        if (typeof originalDebounce === 'function') {
            component.debounceSubmit = function aiduoGuardedDebounce() {
                const result = originalDebounce.apply(this, arguments);
                adapter._cancelDebouncedSubmit();
                return result;
            };
        }
        component.__aiduoWrapped = true;
        this._heldComponent = component;
    },

    _unwrapComponent() {
        const component = this._heldComponent;
        this._heldComponent = null;
        if (!component || !component.__aiduoWrapped) return;
        if (typeof component.__aiduoOriginalSubmit === 'function') component.submit = component.__aiduoOriginalSubmit;
        if (typeof component.__aiduoOriginalDebounce === 'function') component.debounceSubmit = component.__aiduoOriginalDebounce;
        component.__aiduoWrapped = false;
    },

    _hookSubmitButton() {
        const button = this._submitButton();
        if (!button || button.__aiduoClickHook) return;
        const adapter = this;
        const originalClick = button.click;
        if (typeof originalClick === 'function') {
            button.click = function () {
                const already = adapter._allowPlatformSubmit;
                adapter._allowPlatformSubmit = true;
                try {
                    return originalClick.apply(this, arguments);
                } finally {
                    // click() 返回时，表单的 ngSubmit 已经同步跑完。这里再关上。
                    if (!already) adapter._allowPlatformSubmit = false;
                }
            };
        }
        // 教师若直接点页面上的「提交分数」，走的是 DOM 事件而不是 button.click()。
        // 捕获阶段打开，form submit 冒泡阶段再关。不能在 click 冒泡里关：
        // 爱多分的 (ngSubmit) 发生在 click 冒泡之后。
        const root = document.querySelector(AIDUO_SELECTORS.SUBMIT_ROOT);
        const form = button.form || (root && typeof root.querySelector === 'function' ? root.querySelector('form') : null);
        if (form && typeof form.addEventListener === 'function' && !form.__aiduoSubmitHook) {
            form.addEventListener('submit', () => { adapter._allowPlatformSubmit = false; }, false);
            form.__aiduoSubmitHook = true;
        }
        if (form && typeof button.addEventListener === 'function') {
            button.addEventListener('click', () => { adapter._allowPlatformSubmit = true; }, true);
        }
        button.__aiduoClickHook = true;
    },

    _installTimerGuard() {
        if (this._timerGuard) return;
        const adapter = this;
        const nativeSet = window.setTimeout;
        const nativeClear = window.clearTimeout;
        this._timerNativeSet = nativeSet;
        this._timerNativeClear = nativeClear;
        window.setTimeout = function (handler, delay) {
            const ms = typeof delay === 'number' ? delay : 0;
            const id = nativeSet.apply(window, arguments);
            if (adapter._holdActive && ms >= AIDUO_DEBOUNCE_MIN_MS && ms <= AIDUO_DEBOUNCE_MAX_MS) {
                try { nativeClear.call(window, id); } catch (e) { /* ignore */ }
                adapter._cancelDebouncedSubmit();
            }
            return id;
        };
        this._timerGuard = true;
        this._patchZone(true);
    },

    _removeTimerGuard() {
        if (this._timerGuard && this._timerNativeSet) window.setTimeout = this._timerNativeSet;
        this._timerGuard = false;
        this._patchZone(false);
    },

    _patchZone(active) {
        const zone = window.Zone && window.Zone.current;
        if (!zone || typeof zone.scheduleMacroTask !== 'function') return;
        if (active) {
            if (zone.__aiduoOriginalSchedule) return;
            const original = zone.scheduleMacroTask;
            const adapter = this;
            zone.__aiduoOriginalSchedule = original;
            zone.scheduleMacroTask = function (source, callback, data, customSchedule, customCancel) {
                const delay = data && typeof data === 'object' ? Number(data.delay != null ? data.delay : data.timeout) : NaN;
                if (adapter._holdActive && /timeout/i.test(String(source || ''))
                    && delay >= AIDUO_DEBOUNCE_MIN_MS && delay <= AIDUO_DEBOUNCE_MAX_MS) {
                    adapter._cancelDebouncedSubmit();
                    return { type: 'macroTask', source: source, zone: zone, runCount: 0, invoke() {}, cancelScheduleRequest() {} };
                }
                return original.apply(this, arguments);
            };
        } else if (zone.__aiduoOriginalSchedule) {
            zone.scheduleMacroTask = zone.__aiduoOriginalSchedule;
            zone.__aiduoOriginalSchedule = null;
        }
    },

    // 平台在 input 事件里用 0.4–6 秒的 setTimeout 自动提交。填分时清掉这段计时。
    _withoutDebouncedSubmit(fn) {
        const nativeSet = window.setTimeout;
        const nativeClear = window.clearTimeout;
        const captured = [];
        let inside = false;
        window.setTimeout = function (handler, delay) {
            if (inside) return nativeSet.apply(window, arguments);
            inside = true;
            try {
                const id = nativeSet.apply(window, arguments);
                const ms = typeof delay === 'number' ? delay : 0;
                if (ms >= AIDUO_DEBOUNCE_MIN_MS && ms <= AIDUO_DEBOUNCE_MAX_MS) captured.push(id);
                return id;
            } finally {
                inside = false;
            }
        };
        try {
            fn();
        } finally {
            window.setTimeout = nativeSet;
            captured.forEach((id) => {
                try { nativeClear.call(window, id); } catch (e) { /* ignore */ }
            });
            this._cancelDebouncedSubmit();
        }
    },
};

// 注册守卫（#324）：shouldInitialize → 先到先得 → 冲突只告警不覆盖。
// 注册成功后监听地址和批量打分开关，抽查/批量进行中则暂停自动批改。
(function registerAiduoAdapter() {
    try {
        if (!AiduoAdapter.shouldInitialize()) return;
        const existing = window.__AI_MARKER_ADAPTER__;
        if (existing) {
            console.error('🚫 [注册冲突] ' + existing.name + ' 已注册，但 爱多分阅卷(aiduo) 也认领本页（疑似串台/劫持），保留先到者');
            return;
        }
        window.__AI_MARKER_ADAPTER__ = AiduoAdapter;
        const watch = () => {
            try { AiduoAdapter._pauseIfUnsafe(); } catch (e) { /* 守卫失败不打断页面 */ }
        };
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('hashchange', watch);
            window.addEventListener('popstate', watch);
            window.addEventListener('pagehide', () => {
                try { AiduoScanLine.stop(); } catch (e) { /* 页面正在卸载 */ }
                try { if (typeof AiduoProgress !== 'undefined' && AiduoProgress) AiduoProgress.stop(); } catch (e) { /* ignore */ }
            });
        }
        if (typeof window.setInterval === 'function') window.setInterval(watch, 1000);
    } catch (e) {
        console.warn('⚠️ [注册] 判定异常，fail-closed 不注册:', e);
    }
})();
