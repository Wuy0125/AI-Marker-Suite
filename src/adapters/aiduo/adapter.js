// ========== 爱多分（eiduo / xuebanyun）主观题阅卷适配器 ==========
// 本文件属于 AI-Marker-Suite，许可证 GPL-3.0。
// 上游：https://github.com/five-plus-one/AI-Marker-Suite
//
// 只在教师已经登录、并打开主观题阅卷页之后工作。
// 不做登录、不读密码、不写死任何 API 密钥。
//
// 数据安全（对照 #253）：
// - 填分必须写进 Angular 模型。只改 input.value 时，提交仍会送出旧分。
// - 输入框的 input 事件会在 0.5–5 秒后自动交卷。填分期间拆掉这个定时器，
//   交卷只发生在 submitGrade 点「提交分数」时，避免填一半就提交、或提交两次跳卷。
// - 分数对不上、框是 ng-invalid、或读不到模型时，填分/提交都返回 false。
// - 批量打分把一个分数打到多张卡上，检测直接拒绝。
// - 抽查页、?check=true、页头回评标记都不进入自动批改。核心只拿 isRegradeMode
//   跳过方案切换，不会藏按钮，所以检测、填分、提交都要拒绝；已经出现的批改按钮
//   在回评期间藏起来，点击也不开始批改。
// - 换卷只认答题图路径变化（去掉 query）。输入框变空不算换卷。拿不准就超时返回 false。

const AIDUO_TIMING = {
    DETECT_TIMEOUT_MS: 12000,
    IMAGE_POLL_MS: 250,
    IMAGE_STABLE_HITS: 2,
    IMAGE_TIMEOUT_MS: 10000,
    NEXT_PAPER_TIMEOUT_MS: 26000,
    NEXT_PAPER_POLL_MS: 300,
    NEXT_PAPER_STABLE_HITS: 2,
};

const AiduoAdapter = {
    name: '爱多分阅卷',
    id: 'aiduo',
    urlPatterns: [
        '*://ui.eiduo.com/exam-webapp/marking/*',
        '*://ui.xuebanyun.com/exam-webapp/marking/*',
        '*://*.eiduo.com/exam-webapp/marking/*',
        '*://*.xuebanyun.com/exam-webapp/marking/*',
    ],
    iconUrl: 'https://www.eiduo.com/container/favicon-eiduo.ico',

    _expectedScores: null,

    shouldInitialize() {
        return aiduoHostMatches(window.location.hostname) && aiduoPathMatches(window.location.pathname);
    },

    isMarkingPage() {
        return aiduoPathMatches(window.location.pathname);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[爱多分] 当前不是阅卷页 path=', window.location.pathname);
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
            await waitForElement(AIDUO_SELECTORS.SCORE_INPUT, AIDUO_TIMING.DETECT_TIMEOUT_MS).catch(() => null);
            if (this.isRegradeMode()) {
                console.warn('[爱多分] 分数框出现后进入回评，不进入自动批改');
                return false;
            }
            const inputs = this.getScoreInputs();
            const button = this._submitButton();
            const images = this._answerImages();
            const detected = inputs.length > 0 && !!button;
            console.log(`[爱多分] 检测 分数框=${inputs.length} 提交=${!!button} 图=${images.length} => ${detected}`);
            return detected;
        } catch (e) {
            console.error('[爱多分] detectMarkingPage 异常:', e);
            return false;
        }
    },

    getTaskIdentifier() {
        const path = String(window.location.pathname || '').replace(/\/+$/, '');
        const keep = ['examId', 'subjectId', 'isArbitrate', 'check'];
        const parts = [];
        try {
            const params = new URLSearchParams(window.location.search || '');
            keep.forEach(key => {
                const value = params.get(key);
                if (value) parts.push(`${key}=${value}`);
            });
        } catch (e) { /* 忽略畸形 query */ }
        return parts.length ? `${path}?${parts.join('&')}` : path;
    },

    async gatherAnswerImages() {
        const deadline = Date.now() + AIDUO_TIMING.IMAGE_TIMEOUT_MS;
        let prev = '';
        let hits = 0;
        while (Date.now() < deadline) {
            const urls = this._answerUrls();
            const key = aiduoPaperKey(urls);
            if (key) {
                if (key === prev) {
                    hits++;
                    if (hits >= AIDUO_TIMING.IMAGE_STABLE_HITS) {
                        console.log(`[爱多分] 取图 ${urls.length} 张`);
                        return urls;
                    }
                } else {
                    prev = key;
                    hits = 1;
                }
            } else {
                prev = '';
                hits = 0;
            }
            await new Promise(r => setTimeout(r, AIDUO_TIMING.IMAGE_POLL_MS));
        }
        console.warn('[爱多分] 答题图不稳定或没有取到，返回空数组（宁可不批，也不拿上一份的图）');
        return [];
    },

    async fetchImageAsBase64(url) {
        if (typeof url === 'string' && url.startsWith('data:')) {
            const idx = url.indexOf(',');
            return idx >= 0 ? url.slice(idx + 1) : '';
        }
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const nodes = Array.from(document.querySelectorAll(AIDUO_SELECTORS.SCORE_INPUT));
        const inputs = [];
        nodes.forEach(el => {
            if (!aiduoIsScoreInput(el)) return;
            const placeholder = el.getAttribute('placeholder') || '';
            const item = el.closest('.item');
            const titled = item ? item.querySelector('[title]') : null;
            let label = titled ? (titled.getAttribute('title') || titled.textContent || '') : '';
            label = String(label).trim();
            if (!label && item) {
                const step = (item.textContent || '').match(/第\s*\d+\s*步/);
                if (step) label = step[0].replace(/\s/g, '');
            }
            if (!label) label = `评分${inputs.length + 1}`;
            inputs.push({
                element: el,
                label,
                index: inputs.length,
                maxScore: aiduoParseMaxScore(placeholder, el.getAttribute('max')),
            });
        });
        return inputs;
    },

    fillScores(scores) {
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
            if (!Number.isFinite(Number(scores[i]))) {
                console.warn(`[爱多分] 第 ${i + 1} 个分数不是有限数字，拒绝填分`);
                return false;
            }
        }

        const inputs = this.getScoreInputs();
        if (inputs.length !== scores.length) {
            console.warn(`[爱多分] 分数个数 ${scores.length} 与分数框 ${inputs.length} 不一致，拒绝填分`);
            return false;
        }

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (!setter || typeof setter.set !== 'function') {
            console.warn('[爱多分] 无法写入输入框');
            return false;
        }

        try {
            this._withoutDebouncedSubmit(() => {
                for (let i = 0; i < scores.length; i++) {
                    const el = inputs[i].element;
                    setter.set.call(el, String(scores[i]));
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        } catch (e) {
            console.warn('[爱多分] 填分过程异常，拒绝提交', e);
            return false;
        }

        const fresh = this.getScoreInputs();
        if (fresh.length !== scores.length) {
            console.warn('[爱多分] 填分后分数框数量变了，拒绝继续');
            return false;
        }
        for (let i = 0; i < scores.length; i++) {
            const el = fresh[i].element;
            if (!aiduoScoresMatch(scores[i], el.value) || el.classList.contains('ng-invalid')) {
                console.warn(`[爱多分] 第 ${i + 1} 个分数未落稳（值=${el.value}），拒绝提交`);
                return false;
            }
        }

        const model = this._modelScores(this._submitComponent());
        if (!model) {
            console.warn('[爱多分] 读不到阅卷模型，拒绝填分（避免把旧分交上去）');
            return false;
        }
        if (model.length !== scores.length) {
            console.warn(`[爱多分] 模型分数 ${model.length} 与待填 ${scores.length} 不一致，拒绝提交`);
            return false;
        }
        for (let i = 0; i < scores.length; i++) {
            if (!aiduoScoresMatch(scores[i], model[i])) {
                console.warn(`[爱多分] 第 ${i + 1} 个分数没有写进阅卷模型（模型=${model[i]}），拒绝提交`);
                return false;
            }
        }

        this._expectedScores = scores.map(score => Number(score));
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
            if (!aiduoScoresMatch(expected[i], el.value) || String(el.value || '').trim() === '' || el.classList.contains('ng-invalid')) {
                console.warn(`[爱多分] 提交前第 ${i + 1} 个分数框不可用，拒绝点击提交`);
                return false;
            }
        }
        const model = this._modelScores(this._submitComponent());
        if (!model || model.length !== expected.length) {
            console.warn('[爱多分] 提交前读不到阅卷模型，拒绝点击');
            return false;
        }
        for (let i = 0; i < expected.length; i++) {
            if (!aiduoScoresMatch(expected[i], model[i])) {
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
        button.click();
        console.log('[爱多分] 已点击「提交分数」');
        return true;
    },

    async waitForNextPaper(oldImageUrl) {
        const baseline = aiduoImageKey(oldImageUrl) || aiduoImageKey(this._answerUrls()[0] || '');
        if (!baseline) {
            console.warn('[爱多分] 没有基准答题图，不能判断是否换卷');
            return false;
        }
        console.log('[爱多分] 等待下一份', baseline.slice(-48));
        const deadline = Date.now() + AIDUO_TIMING.NEXT_PAPER_TIMEOUT_MS;
        let stable = '';
        let hits = 0;
        while (Date.now() < deadline) {
            const current = aiduoImageKey(this._answerUrls()[0] || '');
            const image = this._answerImages()[0];
            const loaded = !!(image && image.naturalWidth > 0);
            if (current && current !== baseline && loaded) {
                if (current === stable) hits++;
                else {
                    stable = current;
                    hits = 1;
                }
                if (hits >= AIDUO_TIMING.NEXT_PAPER_STABLE_HITS) {
                    console.log('[爱多分] 换卷（答题图路径已变化）');
                    this._expectedScores = null;
                    return true;
                }
            } else {
                stable = '';
                hits = 0;
            }
            await new Promise(r => setTimeout(r, AIDUO_TIMING.NEXT_PAPER_POLL_MS));
        }
        console.warn('[爱多分] 等待下一份超时（未把空分数框当成换卷）');
        return false;
    },

    isRegradeMode() {
        if (aiduoIsRegradeLocation(window.location.pathname, window.location.search)) return true;
        return !!document.querySelector(AIDUO_SELECTORS.REGRADE_FLAG);
    },

    onPageLoad() {
        console.log('[爱多分] 页面加载完成', window.location.hostname, window.location.pathname);
        this._syncRegradeUi();
    },

    // 批改按钮的样式带 display:flex !important，普通 display 盖不住。
    // 只动带 data-aiduo-regrade-hidden 的按钮，离开回评后还原成可点的「AI 批改」。
    _syncRegradeUi() {
        const block = this.isRegradeMode();
        const btn = document.querySelector('.ai-grade-btn');
        if (block) {
            if (btn) {
                btn.setAttribute('data-aiduo-regrade-hidden', '1');
                btn.style.setProperty('display', 'none', 'important');
                btn.disabled = true;
            }
            this._haltGradingForRegrade();
            return;
        }
        this._regradeHalted = false;
        if (btn && btn.getAttribute('data-aiduo-regrade-hidden') === '1') {
            btn.removeAttribute('data-aiduo-regrade-hidden');
            btn.style.removeProperty('display');
            btn.disabled = false;
            this._resetGradeButtonIdle(btn);
        }
    },

    // 对齐 stopAutoGrading：清运行态、按钮文案、提交框和流式面板。
    // 另外清掉自动恢复标记，避免回评结束后刷新又接着批。
    _haltGradingForRegrade() {
        const state = window.aiGradingState;
        const btn = document.querySelector('.ai-grade-btn');
        const dialog = document.getElementById('auto-submit-dialog');
        const running = !!(state && state.isRunning);
        const label = btn ? String(btn.textContent || '').replace(/\s/g, '') : '';
        const chromeDirty = !!(btn && (
            btn.classList.contains('running')
            || btn.classList.contains('paused')
            || btn.classList.contains('unattended')
            || btn.classList.contains('trial')
            || (label && label !== 'AI批改')
        ));
        if (this._regradeHalted && !running && !dialog && !chromeDirty) return;

        if (dialog && dialog.countdownTimer) clearInterval(dialog.countdownTimer);
        if (typeof stopAutoGrading === 'function' && state) {
            try { stopAutoGrading(); } catch (e) { /* 下面再补一次按钮和标记 */ }
        } else if (state) {
            state.isRunning = false;
            state.isPaused = false;
            state.errorRetryCount = 0;
            if (state.abortController) {
                try { state.abortController.abort(); } catch (e) { /* 中止失败不影响拒绝填分 */ }
            }
            if (dialog) dialog.remove();
            if (typeof hideStreamPanel === 'function') {
                try { hideStreamPanel(); } catch (e) { /* 面板可能尚未创建 */ }
            }
        }
        if (state) state.countdownPaused = false;
        try {
            sessionStorage.removeItem('ai-grading-auto-resume');
            sessionStorage.removeItem('ai-grading-retry-count');
        } catch (e) { /* 隐私模式可能禁掉 sessionStorage */ }
        const freshBtn = document.querySelector('.ai-grade-btn');
        if (freshBtn) {
            this._resetGradeButtonIdle(freshBtn);
            freshBtn.setAttribute('data-aiduo-regrade-hidden', '1');
            freshBtn.style.setProperty('display', 'none', 'important');
            freshBtn.disabled = true;
        }
        this._regradeHalted = true;
        console.warn('[爱多分] 进入抽查或回评，已停止自动批改');
    },

    _resetGradeButtonIdle(btn) {
        if (!btn) return;
        btn.textContent = 'AI 批改';
        btn.classList.remove('running', 'paused', 'unattended', 'trial');
    },

    _answerImages() {
        return Array.from(document.querySelectorAll(AIDUO_SELECTORS.ANSWER_IMAGE)).filter(img => {
            return !!aiduoImageKey(img && img.src);
        });
    },

    _answerUrls() {
        return this._answerImages().map(img => img.src);
    },

    _submitButton() {
        const host = document.querySelector(AIDUO_SELECTORS.SUBMIT_HOST);
        if (!host) return null;
        const buttons = host.querySelectorAll('button');
        for (let i = 0; i < buttons.length; i++) {
            const text = (buttons[i].textContent || '').replace(/\s/g, '');
            if (text.indexOf(AIDUO_SELECTORS.SUBMIT_BUTTON_TEXT) !== -1) return buttons[i];
        }
        return null;
    },

    _isBatchMode() {
        const submitVm = this._submitComponent();
        return aiduoIsBatchMode({
            isMultScore: !!((submitVm && submitVm.isMultScore === true) || this._pageMultScore()),
            hasSubmitMult: !!document.querySelector(AIDUO_SELECTORS.BATCH_PANEL),
        });
    },

    // exam-index 上的 isMultScore 才是批量打分开关；打分板 data.length>1 不算。
    _pageMultScore() {
        const host = document.querySelector('exam-index');
        const list = this._contextList(host && host.__ngContext__);
        if (!list) return false;
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (item && item.isMultScore === true && typeof item.multTopic === 'function') return true;
        }
        return false;
    },

    _contextList(ctx) {
        if (Array.isArray(ctx)) return ctx;
        if (ctx && Array.isArray(ctx.lView)) return ctx.lView;
        return null;
    },

    _submitComponent() {
        const host = document.querySelector(AIDUO_SELECTORS.SUBMIT_HOST);
        if (!host) return null;
        const fromHost = this._findSubmitVm(host.__ngContext__);
        if (fromHost) return fromHost;
        const form = host.querySelector('form');
        return form ? this._findSubmitVm(form.__ngContext__) : null;
    },

    // 这份 Angular 构建里，节点上的 __ngContext__ 要么直接是 LView 数组，
    // 要么是 { lView }。组件实例就挂在这一层，不再往子视图里钻，避免环。
    _findSubmitVm(ctx) {
        const list = this._contextList(ctx);
        if (!list) return null;
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (item && typeof item.debounceSubmit === 'function' && typeof item.submit === 'function' && Array.isArray(item.data)) {
                return item;
            }
        }
        return null;
    },

    _modelScores(component) {
        if (!component || !Array.isArray(component.data)) return null;
        const scores = [];
        component.data.forEach(item => {
            if (!item || item.specialType === 1 || item.specialType === 2) return;
            if (item.markingSteps && item.markingSteps.length) {
                item.markingSteps.forEach(step => scores.push(step ? step.score : null));
            } else {
                scores.push(item.score);
            }
        });
        return scores;
    },

    _cancelDebouncedSubmit() {
        const component = this._submitComponent();
        if (component && component.timeoutId != null) {
            clearTimeout(component.timeoutId);
            component.timeoutId = null;
        }
    },

    _withoutDebouncedSubmit(fn) {
        const origSet = window.setTimeout;
        const origClear = window.clearTimeout;
        const pending = [];
        let inside = false;
        window.setTimeout = function(cb, delay) {
            if (inside) return origSet.apply(window, arguments);
            inside = true;
            try {
                const id = origSet.apply(window, arguments);
                const ms = typeof delay === 'number' ? delay : 0;
                if (ms >= 400 && ms <= 6000) pending.push(id);
                return id;
            } finally {
                inside = false;
            }
        };
        try {
            fn();
        } finally {
            window.setTimeout = origSet;
            pending.forEach(id => {
                try { origClear.call(window, id); } catch (e) { /* 定时器可能已被清掉 */ }
            });
            this._cancelDebouncedSubmit();
        }
    },
};

if (AiduoAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = AiduoAdapter;
    // toggleAutoGrading 是函数声明，创建按钮时才会把当时的引用绑到 onclick。
    // 这里先换成回评拦截版，后出现的按钮点下去也不会开始批改。
    if (typeof toggleAutoGrading === 'function' && !toggleAutoGrading.__aiduoPatched) {
        const aiduoOriginalToggle = toggleAutoGrading;
        const aiduoGuardedToggle = function() {
            if (AiduoAdapter.isRegradeMode()) {
                console.warn('[爱多分] 抽查或回评中，不开始自动批改');
                AiduoAdapter._syncRegradeUi();
                return;
            }
            return aiduoOriginalToggle.apply(this, arguments);
        };
        aiduoGuardedToggle.__aiduoPatched = true;
        toggleAutoGrading = aiduoGuardedToggle;
    }
    setInterval(() => {
        try { AiduoAdapter._syncRegradeUi(); } catch (e) { /* 页面拆掉时忽略 */ }
    }, 400);
    console.log(`[爱多分] 适配器已注册 host=${location.hostname} path=${location.pathname}`);
}
