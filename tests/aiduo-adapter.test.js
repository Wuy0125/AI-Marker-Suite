// ========== 爱多分阅卷适配器行为测试 ==========
// 对照已安装构建的行为契约（选择器、填分/提交、抽查回评与批量打分拒绝、
// 输入即提交计时取消、答题图归一化），用 vm 加载真实适配器源码。
// URL：主机名 + pathname/hash，路径前缀与 hash 路由都要能注册。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const SRC = (name) => fs.readFileSync(path.join(ROOT, 'src', 'adapters', 'aiduo', name), 'utf8');

function classList(initial) {
    const set = new Set(initial || []);
    return {
        add(...xs) { xs.forEach((x) => set.add(x)); },
        remove(...xs) { xs.forEach((x) => set.delete(x)); },
        contains: (x) => set.has(x),
    };
}

function makeInput(opts = {}) {
    const el = {
        id: opts.id || '',
        type: opts.type || 'text',
        disabled: !!opts.disabled,
        classList: classList(opts.classes),
        _v: '',
        getAttribute(key) {
            if (key === 'placeholder') return opts.placeholder == null ? '' : opts.placeholder;
            if (key === 'max') return opts.max == null ? null : String(opts.max);
            if (key === 'disabled') return opts.disabled ? '' : null;
            return null;
        },
        closest: (sel) => (sel === '.item' ? (opts.item || null) : null),
        dispatchEvent() { if (opts.onEvent) opts.onEvent(el); },
        get value() { return opts.swallow ? '' : (this._v ?? ''); },
        set value(v) { this._v = String(v); },
    };
    return el;
}

function makeButton(text, opts = {}) {
    return {
        tagName: 'BUTTON',
        textContent: text,
        disabled: !!opts.disabled,
        classList: classList(),
        getAttribute: (key) => (key === 'disabled' && opts.disabled ? '' : null),
        click() { this.clicked = (this.clicked || 0) + 1; },
    };
}

function load(opts = {}) {
    const inputs = opts.inputs || [];
    const images = opts.images || [];
    const buttons = opts.buttons || [makeButton('提交分数')];
    const component = opts.component || {
        debounceSubmit() {},
        submit() {},
        data: inputs.map(() => ({ score: null, specialType: 0 })),
        timeoutId: null,
        isMultScore: false,
    };
    const submitRoot = {
        __ngContext__: opts.context === undefined ? [null, component] : opts.context,
        querySelectorAll: (sel) => (sel === 'button' ? buttons : []),
        querySelector: (sel) => (sel === 'form' ? (opts.form || null) : null),
    };
    const gradeBtn = {
        textContent: '暂停',
        disabled: false,
        classList: classList(['running']),
        style: {},
        setAttribute() {},
        removeAttribute() {},
    };
    const state = opts.state || { isRunning: false, isPaused: false, errorRetryCount: 0 };
    const intervals = [];
    const timers = [];
    let seq = 1;
    const sb = {
        console: { log() {}, warn() {}, error() {}, info() {} },
        location: {
            hostname: opts.host || 'ui.eiduo.com',
            pathname: opts.path == null ? '/school/exam-webapp/marking/index' : opts.path,
            hash: opts.hash || '',
            search: opts.search || '',
            href: 'https://ui.eiduo.com/',
        },
        URL,
        URLSearchParams,
        Event: class { constructor(type) { this.type = type; } },
        setInterval: (fn) => { intervals.push(fn); return intervals.length; },
        clearInterval: () => {},
        setTimeout: (fn, ms) => {
            const id = seq++;
            timers.push({ id, ms, fn, cleared: false });
            return id;
        },
        clearTimeout: (id) => {
            const t = timers.find((x) => x.id === id);
            if (t) t.cleared = true;
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        aiGradingState: state,
        sessionStorage: { removeItem() {}, getItem: () => null, setItem() {} },
        __AI_MARKER_WAIT_WINDOW_MS__: opts.waitMs,
        __AI_MARKER_AIDUO_GATHER_MS__: opts.gatherMs,
    };
    sb.HTMLInputElement = {
        prototype: {
            get value() { return this._v; },
            set value(v) { this._v = String(v); },
        },
    };
    sb.document = {
        querySelectorAll: (sel) => {
            const text = String(sel);
            if (text.indexOf('submit-bd') !== -1) return inputs;
            if (text.indexOf('img') !== -1) return images;
            return [];
        },
        querySelector: (sel) => {
            const text = String(sel);
            if (text === 'exam-submit') return submitRoot;
            if (text.indexOf('submit-mult') !== -1) return opts.batchEl || null;
            if (text.indexOf('status-remark') !== -1) return opts.regradeEl || null;
            if (text === 'exam-index') return opts.examIndex || null;
            if (text === '.ai-grade-btn') return gradeBtn;
            return null;
        },
        getElementById: (id) => (id === 'auto-submit-dialog' ? (opts.dialog || null) : null),
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC('selectors.js'), sb, { filename: 'aiduo/selectors.js' });
    vm.runInContext(SRC('adapter.js'), sb, { filename: 'aiduo/adapter.js' });
    const adapter = sb.__AI_MARKER_ADAPTER__ || null;
    return { adapter, sb, component, inputs, images, buttons, gradeBtn, intervals, timers, state };
}

function wireModel(component, inputs) {
    inputs.forEach((el, index) => {
        el.dispatchEvent = () => {
            const raw = el.value;
            const score = raw === '' ? null : Number(raw);
            const steps = component.data[0] && component.data[0].markingSteps;
            if (steps && steps.length) {
                if (steps[index]) steps[index].score = score;
            } else if (component.data[index]) {
                component.data[index].score = score;
            }
            component.timeoutId = el.ownerSetTimeout(800);
        };
        el.ownerSetTimeout = (ms) => {
            throw new Error('ownerSetTimeout not bound');
        };
    });
}

test('脚本头 match 与 include 覆盖路径前缀和 hash 路由，且不放开整站', () => {
    const src = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
    for (const pattern of [
        '*://*.eiduo.com/*exam-webapp/marking/*',
        '*://eiduo.com/*exam-webapp/marking/*',
        '*://*.xuebanyun.com/*exam-webapp/marking/*',
        '*://xuebanyun.com/*exam-webapp/marking/*',
    ]) {
        assert.ok(src.includes(pattern), '缺少 match: ' + pattern);
    }
    const quoted = src.match(/'(\/\^https\?:[^'\n]*eiduo[^'\n]*xuebanyun[^'\n]*marking[^'\n]*)'/);
    assert.ok(quoted, 'build.js 应有爱多分 @include 正则');
    const literal = Function('return ' + quoted[0])();
    const body = literal.match(/^\/([\s\S]*)\/([a-z]*)$/);
    assert.ok(body, 'include 应为 /pattern/flags');
    const re = new RegExp(body[1], body[2]);
    const yes = [
        'https://ui.eiduo.com/exam-webapp/marking/index',
        'https://ui.eiduo.com/school/exam-webapp/marking/index',
        'https://ui.eiduo.com/#/exam-webapp/marking/index',
        'https://ui.eiduo.com/app/#/tenant/exam-webapp/marking/check-index',
        'https://eiduo.com/exam-webapp/marking/index',
        'https://a.b.xuebanyun.com/x/exam-webapp/marking/index?check=true',
        'https://UI.XUEBANYUN.COM/exam-webapp/marking/index',
    ];
    const no = [
        'https://ui.eiduo.com/',
        'https://ui.eiduo.com/login',
        'https://www.eiduo.com/container/favicon-eiduo.ico',
        'https://evil.com/exam-webapp/marking/index',
        'https://eiduo.com.evil.com/exam-webapp/marking/index',
        'https://noteeiduo.com/exam-webapp/marking/index',
    ];
    for (const url of yes) assert.ok(re.test(url), '应匹配 ' + url);
    for (const url of no) assert.ok(!re.test(url), '不应匹配 ' + url);
});

test('路径前缀、hash 路由、学伴云和裸域可以注册；登录页和仿冒域不行', () => {
    assert.ok(load({ path: '/school/exam-webapp/marking/index' }).adapter, '路径前缀');
    const hashed = load({ path: '/', hash: '#/tenant/exam-webapp/marking/index' });
    assert.ok(hashed.adapter, 'hash 路由');
    assert.strictEqual(hashed.adapter.isMarkingPage(), true);
    assert.ok(load({ host: 'a.b.xuebanyun.com', path: '/exam-webapp/marking/check-index' }).adapter, '学伴云');
    assert.ok(load({ host: 'eiduo.com', path: '/exam-webapp/marking/index' }).adapter, '裸域');
    assert.strictEqual(load({ path: '/login', hash: '' }).adapter, null, '登录页不注册');
    assert.strictEqual(load({ host: 'eiduo.com.evil.com', path: '/exam-webapp/marking/index' }).adapter, null);
    assert.strictEqual(load({ host: 'noteeiduo.com', path: '/exam-webapp/marking/index' }).adapter, null);
    assert.strictEqual(load({ host: 'www.eiduo.com', path: '/', hash: '#/home' }).adapter, null);
});

test('任务标识保留路由和题目参数，hash 查询里的 check 也算', () => {
    const { adapter } = load({
        path: '/school/exam-webapp/marking/index/',
        hash: '#/exam-webapp/marking/index?check=true&noise=1',
        search: '?examId=9&subjectId=3&unused=1',
    });
    assert.strictEqual(
        adapter.getTaskIdentifier(),
        '/school/exam-webapp/marking/index#/exam-webapp/marking/index?examId=9&subjectId=3&check=true'
    );
});

test('分数框只收满分输入，跳过评语、行列和隐藏框', () => {
    const score = makeInput({
        placeholder: '满分10',
        item: {
            textContent: '第 2 步',
            querySelector: () => ({ getAttribute: () => '第二问', textContent: '第二问' }),
        },
    });
    const comment = makeInput({ placeholder: '评语' });
    const hidden = makeInput({ placeholder: '满分5', type: 'hidden' });
    const row = makeInput({ id: 'row', max: '10' });
    const byMax = makeInput({ max: '6.5', placeholder: '' });
    const { adapter } = load({ inputs: [score, comment, hidden, row, byMax] });
    const found = adapter.getScoreInputs();
    assert.strictEqual(found.length, 2);
    assert.strictEqual(found[0].label, '第二问');
    assert.strictEqual(found[0].maxScore, 10);
    assert.strictEqual(found[1].maxScore, 6.5);
    assert.strictEqual(found[0].index, 0);
    assert.strictEqual(found[1].index, 1);
});

test('填分全或无：个数不符、NaN、负数、越界、写不进去都拒绝', () => {
    const kept = makeInput({ placeholder: '满分10' });
    const { adapter } = load({ inputs: [kept] });
    assert.strictEqual(adapter.fillScores([]), false);
    assert.strictEqual(adapter.fillScores([1, 2]), false);
    assert.strictEqual(adapter.fillScores([NaN]), false);
    assert.strictEqual(adapter.fillScores([-1]), false);
    assert.strictEqual(adapter.fillScores([11]), false);
    assert.strictEqual(kept.value, '');
    const swallow = makeInput({ placeholder: '满分10', swallow: true });
    const refused = load({ inputs: [swallow], component: {
        debounceSubmit() {},
        submit() {},
        data: [{ score: null, specialType: 0 }],
        timeoutId: 42,
        isMultScore: false,
    } });
    swallow.dispatchEvent = () => { refused.component.timeoutId = refused.sb.setTimeout(() => {}, 800); };
    assert.strictEqual(refused.adapter.fillScores([3]), false);
    assert.strictEqual(refused.component.timeoutId, null, '写不进去也要取消输入即提交计时');
});

test('填分写入输入框和阅卷模型，并取消 0.4 到 6 秒的输入即提交计时', () => {
    const component = {
        debounceSubmit() {},
        submit() {},
        data: [{ specialType: 1, score: 9 }, { specialType: 0, markingSteps: [{ score: null }, { score: null }] }],
        timeoutId: null,
        isMultScore: false,
    };
    const a = makeInput({ placeholder: '满分10' });
    const b = makeInput({ placeholder: '满分8' });
    const env = load({ inputs: [a, b], component, context: [component] });
    a.dispatchEvent = () => {
        component.data[1].markingSteps[0].score = Number(a.value);
        component.timeoutId = env.sb.setTimeout(() => { component.auto = true; }, 800);
    };
    b.dispatchEvent = () => {
        component.data[1].markingSteps[1].score = Number(b.value);
        env.sb.setTimeout(() => { component.auto = true; }, 50);
    };
    assert.strictEqual(env.adapter.fillScores([2.5, 8]), true);
    assert.strictEqual(a.value, '2.5');
    assert.strictEqual(b.value, '8');
    assert.strictEqual(component.timeoutId, null);
    assert.ok(env.timers.some((t) => t.ms === 800 && t.cleared), '800ms 提交计时必须清掉');
    assert.ok(env.timers.some((t) => t.ms === 50 && !t.cleared), '短计时不是输入即提交');
    assert.notStrictEqual(component.auto, true);
    env.buttons[0].click = function () { this.clicked = 1; };
    assert.strictEqual(env.adapter.submitGrade(), true);
    assert.strictEqual(env.buttons[0].clicked, 1);
});

test('填分返回后异步排上的提交计时不得提交，确认后才放行', async () => {
    const component = {
        submitted: 0,
        debounceSubmit() {
            this.timeoutId = setTimeout(() => this.submit(), 800);
        },
        submit() { this.submitted += 1; },
        data: [{ score: null, specialType: 0 }],
        timeoutId: null,
        isMultScore: false,
    };
    const input = makeInput({ placeholder: '满分10' });
    const env = load({ inputs: [input], component, context: [component] });
    env.sb.setTimeout = setTimeout;
    env.sb.clearTimeout = clearTimeout;
    input.dispatchEvent = () => { component.data[0].score = Number(input.value); };
    assert.strictEqual(env.adapter.fillScores([6]), true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    setTimeout(() => component.debounceSubmit(), 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    component.submit();
    assert.strictEqual(component.timeoutId, null, '异步 debounce 排上的计时必须清掉');
    assert.strictEqual(component.submitted, 0, '按住期间平台 submit 必须是空操作');

    env.buttons[0].click = function () {
        this.clicked = (this.clicked || 0) + 1;
        component.submit();
    };
    assert.strictEqual(env.adapter.submitGrade(), true);
    assert.strictEqual(env.buttons[0].clicked, 1);
    assert.strictEqual(component.submitted, 1, '确认提交点击「提交分数」后才真正提交');
    if (component.timeoutId != null) clearTimeout(component.timeoutId);
});

test('模型没跟上、按钮禁用、抽查回评、批量打分时拒绝点击提交', () => {
    const input = makeInput({ placeholder: '满分10', onEvent: () => {} });
    const stuck = load({ inputs: [input] });
    assert.strictEqual(stuck.adapter.fillScores([4]), false, '模型仍是空分时不得记为填分成功');
    assert.strictEqual(stuck.adapter.submitGrade(), false);
    assert.ok(!stuck.buttons[0].clicked);

    const ok = makeInput({ placeholder: '满分10' });
    const env = load({ inputs: [ok], buttons: [makeButton('提交分数', { disabled: true })] });
    ok.dispatchEvent = () => { env.component.data[0].score = Number(ok.value); };
    assert.strictEqual(env.adapter.fillScores([4]), true);
    assert.strictEqual(env.adapter.submitGrade(), false);
    assert.ok(!env.buttons[0].clicked);

    const regrade = load({ path: '/exam-webapp/marking/check-index', inputs: [makeInput({ placeholder: '满分10' })] });
    assert.strictEqual(regrade.adapter.isRegradeMode(), true);
    assert.strictEqual(regrade.adapter.fillScores([1]), false);

    const queried = load({ search: '?check=true', inputs: [makeInput({ placeholder: '满分10' })] });
    assert.strictEqual(queried.adapter.isRegradeMode(), true);
    const hashed = load({ hash: '#/exam-webapp/marking/index?check=true' });
    assert.strictEqual(hashed.adapter.isRegradeMode(), true);
    const marked = load({ regradeEl: { className: 'status status-remark' } });
    assert.strictEqual(marked.adapter.isRegradeMode(), true);

    const batched = load({
        batchEl: { className: 'submit-mult' },
        inputs: [makeInput({ placeholder: '满分10' })],
    });
    assert.strictEqual(batched.adapter.fillScores([1]), false);
    assert.strictEqual(batched.adapter.submitGrade(), false);

    const pageBatch = load({
        inputs: [makeInput({ placeholder: '满分10' })],
        examIndex: { __ngContext__: [{ isMultScore: true, multTopic() {} }] },
    });
    assert.strictEqual(pageBatch.adapter.fillScores([1]), false);
});

test('进行中的自动批改遇到抽查或批量打分会暂停', () => {
    const env = load({
        path: '/exam-webapp/marking/index',
        state: { isRunning: true, isPaused: false, errorRetryCount: 2 },
    });
    env.sb.location.pathname = '/exam-webapp/marking/check-index';
    assert.ok(env.intervals.length >= 1);
    env.intervals[0]();
    assert.strictEqual(env.state.isRunning, false);
    assert.strictEqual(env.state.isPaused, true);
    assert.strictEqual(env.gradeBtn.textContent, '继续批改');
    assert.ok(env.gradeBtn.classList.contains('paused'));
});

test('换卷只认稳定的答题图路径，空分数框和查询串抖动都不算', async () => {
    const img = { src: 'https://cdn.example/papers/a.jpg?token=1', naturalWidth: 120 };
    const input = makeInput({ placeholder: '满分10' });
    input._v = '5';
    const env = load({
        inputs: [input],
        images: [img],
        waitMs: 360,
    });
    input._v = '';
    env.sb.setTimeout = setTimeout;
    env.sb.clearTimeout = clearTimeout;
    const started = Date.now();
    const same = await env.adapter.waitForNextPaper(img.src);
    assert.strictEqual(same, false);
    assert.ok(Date.now() - started >= 300, '应等满窗口，而不是看到空框就返回');

    const queryOnly = load({ images: [{ src: 'https://cdn.example/papers/a.jpg?token=1', naturalWidth: 80 }], waitMs: 280 });
    queryOnly.sb.setTimeout = setTimeout;
    queryOnly.sb.clearTimeout = clearTimeout;
    setTimeout(() => { queryOnly.images[0].src = 'https://cdn.example/papers/a.jpg?token=2'; }, 40);
    assert.strictEqual(await queryOnly.adapter.waitForNextPaper(queryOnly.images[0].src), false);

    const next = load({ images: [{ src: 'https://cdn.example/papers/a.jpg', naturalWidth: 80 }], waitMs: 800 });
    next.sb.setTimeout = setTimeout;
    next.sb.clearTimeout = clearTimeout;
    setTimeout(() => {
        next.images[0].src = 'https://cdn.example/papers/b.jpg?x=9';
        next.images[0].naturalWidth = 90;
    }, 60);
    assert.strictEqual(await next.adapter.waitForNextPaper('https://cdn.example/papers/a.jpg'), true);

    const missing = load({ images: [], waitMs: 5000 });
    missing.sb.setTimeout = setTimeout;
    missing.sb.clearTimeout = clearTimeout;
    const t0 = Date.now();
    assert.strictEqual(await missing.adapter.waitForNextPaper(''), false);
    assert.ok(Date.now() - t0 < 200, '没有基准图时应立即失败，不能空等');
});

test('取图要稳定两次，丢掉 favicon 和资源图，不稳定就返回空', async () => {
    const good = { src: 'https://cdn.example/papers/a.jpg?sig=1', naturalWidth: 10 };
    const icon = { src: 'https://www.eiduo.com/assets/logo.png', naturalWidth: 16 };
    const env = load({ images: [good, icon], gatherMs: 700 });
    env.sb.setTimeout = setTimeout;
    env.sb.clearTimeout = clearTimeout;
    const urls = await env.adapter.gatherAnswerImages();
    assert.deepStrictEqual(Array.from(urls), [good.src]);

    const flip = { src: 'https://cdn.example/papers/a.jpg', naturalWidth: 10 };
    const shaky = load({ images: [flip], gatherMs: 400 });
    shaky.sb.setTimeout = (fn, ms) => {
        flip.src = flip.src.indexOf('/a.jpg') !== -1
            ? 'https://cdn.example/papers/b.jpg'
            : 'https://cdn.example/papers/a.jpg';
        return setTimeout(fn, ms);
    };
    shaky.sb.clearTimeout = clearTimeout;
    assert.deepStrictEqual(Array.from(await shaky.adapter.gatherAnswerImages()), []);
});

test('普通阅卷页能认出分数框和提交按钮；抽查页和批量打分页不进入自动批改', async () => {
    const input = makeInput({ placeholder: '满分10' });
    const env = load({ inputs: [input] });
    env.sb.waitForElement = () => Promise.resolve(input);
    assert.strictEqual(await env.adapter.detectMarkingPage(), true);

    const check = load({ path: '/exam-webapp/marking/check-index', inputs: [input] });
    check.sb.waitForElement = () => Promise.resolve(input);
    assert.strictEqual(await check.adapter.detectMarkingPage(), false);

    const batch = load({ inputs: [input], batchEl: {} });
    batch.sb.waitForElement = () => Promise.resolve(input);
    assert.strictEqual(await batch.adapter.detectMarkingPage(), false);
});

test('爱多分普通模式不倒计时自动提交，无人值守和其他平台保持原样', () => {
    const { env, load: loadCore } = require('./_audit-harness');
    function openDialog(mode, manualConfirm) {
        const e = env();
        e.state.gradingMode = mode;
        e.state.isRunning = true;
        if (manualConfirm) e.adapter.requiresManualConfirm = true;
        loadCore(e, 'src/core/ui-submit-dialog.js');
        const dialog = e.sb.showAutoSubmitDialog(6, '评语', null);
        assert.ok(dialog, mode + ' 弹窗应出现');
        return { e, dialog, html: String(dialog.innerHTML || '') };
    }
    const aiduoNormal = openDialog('normal', true);
    assert.strictEqual(aiduoNormal.dialog.countdownTimer, undefined);
    assert.ok(aiduoNormal.html.includes('等待教师确认'), '普通模式应等教师确认');
    assert.ok(!aiduoNormal.html.includes('id="countdown-number"'), '普通模式不得出现倒计时');

    const aiduoUnattended = openDialog('unattended', true);
    assert.ok(aiduoUnattended.dialog.countdownTimer, '无人值守仍保留短倒计时');
    assert.ok(aiduoUnattended.html.includes('id="countdown-number"'));

    const otherNormal = openDialog('normal', false);
    assert.ok(otherNormal.dialog.countdownTimer, '其他平台普通模式仍倒计时自动提交');
    assert.ok(otherNormal.html.includes('id="countdown-number"'));
});

test('试改确认后只交这一份，不再等待下一份', async () => {
    const { env, load: loadCore } = require('./_audit-harness');
    const e = env();
    e.state.gradingMode = 'trial';
    e.state.isRunning = true;
    let advanced = 0;
    e.adapter.waitForNextPaper = async () => { advanced += 1; return true; };
    loadCore(e, 'src/core/main.js');
    loadCore(e, 'src/core/ui-submit-dialog.js');
    e.sb.startAutoGrading = () => { advanced += 1; };
    const dialog = e.sb.showAutoSubmitDialog(6, '评语', null);
    assert.ok(dialog, '试改弹窗应出现');
    await dialog.confirmSubmit();
    assert.strictEqual(advanced, 0, '试改确认后不得进入下一份');
    assert.strictEqual(e.state.isRunning, false);
});
