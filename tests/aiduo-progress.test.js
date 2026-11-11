// ========== 爱多分最后一份：继续阅本题 ==========
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const test = require('node:test');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'adapters', 'aiduo', 'progress-monitor.js'), 'utf8');

function makeButton(text) {
    return {
        tagName: 'BUTTON',
        textContent: text,
        hidden: false,
        style: {},
        parentElement: null,
        clicked: 0,
        click() { this.clicked += 1; },
    };
}

function load(progressText) {
    const buttons = [];
    const body = {
        textContent: progressText,
        innerText: progressText,
        style: {},
        parentElement: null,
        hidden: false,
    };
    const observers = [];
    const intervals = [];
    let seq = 1;
    const document = {
        body,
        documentElement: body,
        querySelectorAll() { return buttons.slice(); },
    };
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document,
        MutationObserver: class {
            constructor(cb) { this.cb = cb; observers.push(this); }
            observe() {}
            disconnect() { this.disconnected = true; }
        },
        setInterval(fn) { const id = seq++; intervals.push({ id, fn, cleared: false }); return id; },
        clearInterval(id) {
            const timer = intervals.find((item) => item.id === id);
            if (timer) timer.cleared = true;
        },
        Date, parseInt, Number, Array, String,
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC, sb, { filename: 'progress-monitor.js' });
    vm.runInContext('globalThis.AiduoProgress = AiduoProgress;', sb);
    return {
        progress: sb.AiduoProgress,
        buttons,
        body,
        observers,
        intervals,
        add(text) {
            const button = makeButton(text);
            button.parentElement = body;
            buttons.push(button);
            return button;
        },
    };
}

test('解析阅卷进度：0/83 不是最后一份，83/83 才是', () => {
    const env = load('');
    const early = env.progress.parse('阅卷进度：0/83，最多可阅83份');
    assert.deepStrictEqual({ current: early.current, total: early.total, last: early.last }, { current: 0, total: 83, last: false });
    const done = env.progress.parse('阅卷进度：83/83，最多可阅83份');
    assert.strictEqual(done.last, true);
    const spaced = env.progress.parse('阅卷进度： 83 / 83 ，最多可阅 83 份');
    assert.strictEqual(spaced.last, true);
    assert.strictEqual(env.progress.parse('最多可阅83份'), null);
    assert.strictEqual(env.progress.parse('正在阅卷'), null);
    assert.strictEqual(env.progress.parse('阅卷进度：82/83').last, false);
});

test('最后一份提交前不点；提交后只点继续阅本题', () => {
    const env = load('阅卷进度：83/83，最多可阅83份');
    const stay = env.add('继\u00a0续阅本题');
    const next = env.add('阅下一道题');
    const submit = env.add('提交分数');
    assert.strictEqual(stay.clicked, 0, '分数出现或弹窗先出来都还不能点');
    assert.strictEqual(env.progress.noteSubmitted(), true);
    assert.strictEqual(stay.clicked, 1);
    assert.strictEqual(next.clicked, 0);
    assert.strictEqual(submit.clicked, 0);
    if (env.observers[0]) env.observers[0].cb();
    assert.strictEqual(stay.clicked, 1, '同一个弹窗只点一次');
});

test('82/83 或解析失败时，即使弹窗出现也不点', () => {
    const mid = load('阅卷进度：82/83，最多可阅83份');
    assert.strictEqual(mid.progress.noteSubmitted(), false);
    const stay = mid.add('继续阅本题');
    const next = mid.add('阅下一道题');
    if (mid.observers[0]) mid.observers[0].cb();
    assert.strictEqual(stay.clicked, 0);
    assert.strictEqual(next.clicked, 0);

    const bad = load('阅卷进度不详');
    assert.strictEqual(bad.progress.noteSubmitted(), false);
    bad.add('继续阅本题');
    bad.add('阅下一道题');
    assert.strictEqual(bad.buttons[0].clicked, 0);
});

test('只有一个选项、弹窗已消失、或稍后才出现时的行为', () => {
    const only = load('阅卷进度：83/83');
    only.add('继续阅本题');
    assert.strictEqual(only.progress.noteSubmitted(), true);
    assert.strictEqual(only.buttons[0].clicked, 0, '只有继续阅本题时不点');
    only.progress.stop();

    const late = load('阅卷进度：83/83，最多可阅83份');
    assert.strictEqual(late.progress.noteSubmitted(), true);
    assert.ok(late.observers.length >= 1);
    const stay = late.add('继续阅本题');
    const next = late.add('阅下一道题');
    late.observers[0].cb();
    assert.strictEqual(stay.clicked, 1);
    assert.strictEqual(next.clicked, 0);
    assert.ok(late.intervals.every((timer) => timer.cleared));

    const gone = load('阅卷进度：83/83');
    const hiddenStay = gone.add('继续阅本题');
    const hiddenNext = gone.add('阅下一道题');
    hiddenStay.style.display = 'none';
    assert.strictEqual(gone.progress.noteSubmitted(), true);
    assert.strictEqual(hiddenStay.clicked, 0, '已关掉的弹窗不再点');
    assert.strictEqual(hiddenNext.clicked, 0);
    gone.progress.stop();
});
