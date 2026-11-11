// ========== 首次使用 / 新试题引导 ==========
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function makeEl(tag) {
    const el = {
        tagName: String(tag || 'div').toUpperCase(),
        id: '',
        className: '',
        classList: new Set(),
        attrs: {},
        style: { display: '', background: '', color: '', setProperty() {} },
        value: '',
        disabled: false,
        hidden: false,
        textContent: '',
        innerHTML: '',
        children: [],
        parentElement: null,
        parentNode: null,
        onclick: null,
        onchange: null,
        setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'id') this.id = String(value); },
        getAttribute(key) { return this.attrs[key] == null ? null : this.attrs[key]; },
        appendChild(child) {
            child.parentElement = this;
            child.parentNode = this;
            this.children.push(child);
            return child;
        },
        remove() {
            if (this.parentNode) {
                this.parentNode.children = this.parentNode.children.filter((item) => item !== this);
            }
            this.parentNode = null;
            this.parentElement = null;
        },
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
        querySelectorAll(sel) { return collect(this, sel); },
    };
    return el;
}

function collect(root, sel) {
    const out = [];
    const walk = (node) => {
        if (node !== root && matches(node, sel)) out.push(node);
        (node.children || []).forEach(walk);
    };
    walk(root);
    return out;
}

function matches(node, sel) {
    if (sel.startsWith('#')) return node.id === sel.slice(1);
    if (sel.startsWith('.')) return node.classList.has(sel.slice(1)) || String(node.className).split(/\s+/).includes(sel.slice(1));
    const named = sel.match(/^input\[name="([^"]+)"\]$/);
    if (named) return node.tagName === 'INPUT' && node.attrs.name === named[1];
    return false;
}

function ingest(html) {
    const nodes = [];
    const tagRe = /<([a-zA-Z0-9]+)([^>]*)>/g;
    let match;
    while ((match = tagRe.exec(html))) {
        const tag = match[1].toLowerCase();
        if (tag === 'div' || tag === 'span' || tag === 'button' || tag === 'input' || tag === 'a' || tag === 'label' || tag === 'p') {
            const el = makeEl(tag);
            const attrs = match[2] || '';
            const id = attrs.match(/\sid="([^"]+)"/) || attrs.match(/^id="([^"]+)"/);
            const name = attrs.match(/\sname="([^"]+)"/) || attrs.match(/^name="([^"]+)"/);
            const cls = attrs.match(/\sclass="([^"]+)"/);
            const value = attrs.match(/\svalue="([^"]*)"/);
            const type = attrs.match(/\stype="([^"]+)"/);
            const field = attrs.match(/\sdata-field="([^"]+)"/);
            if (id) el.id = id[1];
            if (name) el.attrs.name = name[1];
            if (cls) {
                el.className = cls[1];
                cls[1].split(/\s+/).forEach((item) => item && el.classList.add(item));
            }
            if (value) el.value = value[1];
            if (type) el.attrs.type = type[1];
            if (field) el.attrs['data-field'] = field[1];
            if (id || name || cls || field) nodes.push(el);
        }
    }
    return nodes;
}

function boot(apiKey) {
    const store = {};
    const provider = { apiKey: apiKey || '', endpoint: 'https://api.test' };
    const presets = { list: { '默认配置': { question: '', answer: '', rubric: '' } }, active: '默认配置', bindings: {} };
    const head = makeEl('head');
    const root = makeEl('div');
    const ids = new Map();
    ids.set('ai-grading-settings', makeEl('div'));
    const document = {
        head,
        body: makeEl('body'),
        createElement: (tag) => makeEl(tag),
        getElementById: (id) => ids.get(id) || head.children.find((child) => child.id === id) || null,
    };
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document,
        setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
        clearTimeout() {},
        GM_getValue: (key, fallback) => (key in store ? store[key] : fallback),
        GM_setValue: (key, value) => { store[key] = value; },
        GM_xmlhttpRequest: (opts) => { opts.onload({ status: 200, responseText: '{}' }); },
        SCRIPT_CONFIG: { VERSION: '1.21.18.11', DEFAULT_ENDPOINT: 'https://api.test/v1' },
        ensureModalStyles() {},
        getUIRoot: () => root,
        showToast() {},
        createMainButton() {},
        openSettingsPanel() { sb.openedSettings = true; },
        ProviderManager: {
            data: { activeProvider: '5plus1官方', activeModel: 'aimarker-fast' },
            getProvider: (name) => (name === '5plus1官方' ? provider : null),
            save() {},
        },
        PresetManager: {
            data: presets,
            save() {},
            getTaskIdentifier: () => 'task-1',
        },
        WorkflowManager: {
            setActive() {},
            getWorkflow: () => ({ model: { provider: '5plus1官方', model: 'aimarker-fast' } }),
        },
        window: null,
    };
    sb.window = sb;
    const hookHtml = (el) => {
        let html = '';
        Object.defineProperty(el, 'innerHTML', {
            get() { return html; },
            set(value) {
                html = String(value);
                el.children = ingest(html);
                el.children.forEach((child) => { child.parentElement = el; });
                el.children.forEach((child) => { if (child.id) ids.set(child.id, child); });
            },
        });
    };
    const created = [];
    document.createElement = (tag) => {
        const el = makeEl(tag);
        hookHtml(el);
        el.querySelector = (sel) => {
            const found = collectNested(el, sel);
            return found[0] || null;
        };
        el.querySelectorAll = (sel) => collectNested(el, sel);
        created.push(el);
        return el;
    };
    head.appendChild = (child) => { child.parentNode = head; head.children.push(child); if (child.id) ids.set(child.id, child); return child; };
    vm.createContext(sb);
    vm.runInContext(read('src/core/ui-settings.js'), sb, { filename: 'ui-settings.js' });
    sb.renderPresetDropdown = () => {};
    sb.fillFormFromActivePreset = () => {};
    sb.openSettingsPanel = () => { sb.openedSettings = true; };
    return { sb, store, provider, presets, created };
}

function collectNested(root, sel) {
    const out = [];
    const walk = (node) => {
        (node.children || []).forEach((child) => {
            if (matches(child, sel)) out.push(child);
            walk(child);
        });
    };
    walk(root);
    return out;
}

function overlayOf(env) {
    return env.created.find((el) => String(el.className).includes('ai-modal-overlay')) || env.created[env.created.length - 1];
}

function titleOf(overlay) {
    const html = overlay.innerHTML || '';
    const titles = ['欢迎使用 AI 批改助手', '批改上下文（可选）', '选择批改工作流', '配置完成！', '配置方案'];
    return titles.find((title) => html.includes(title)) || '';
}

test('首次引导依次出现 5 步，空密钥被拒绝，完成后清除标记', async () => {
    const env = boot('');
    env.sb.showOnboardingDialog(true, 'first-launch');
    const overlay = overlayOf(env);
    assert.strictEqual(titleOf(overlay), '欢迎使用 AI 批改助手');
    assert.ok(overlay.innerHTML.includes('验证并继续'));
    assert.ok(overlay.innerHTML.includes('稍后设置'));
    assert.ok(overlay.innerHTML.includes('https://api.ai.five-plus-one.com/console/token'));

    await overlay.querySelector('#ob-next').onclick();
    assert.strictEqual(overlay.querySelector('#ob-status').textContent, '请输入 API 密钥');
    assert.notStrictEqual(env.store['ai-grading-show-onboarding'], false);

    overlay.querySelector('#ob-apikey').value = 'sk-test';
    await overlay.querySelector('#ob-next').onclick();
    assert.strictEqual(env.provider.apiKey, 'sk-test');
    assert.strictEqual(titleOf(overlay), '配置方案');
    assert.ok(overlay.innerHTML.includes('普通'));
    assert.ok(overlay.innerHTML.includes('试改'));
    assert.ok(overlay.innerHTML.includes('无人'));

    overlay.querySelector('#ob-preset-name').value = '语文作文';
    overlay.querySelector('#ob-next').onclick();
    assert.strictEqual(titleOf(overlay), '选择批改工作流');
    assert.ok(overlay.innerHTML.includes('快速批改'));
    assert.ok(overlay.innerHTML.includes('双评模式'));

    overlay.querySelector('#ob-next').onclick();
    assert.strictEqual(titleOf(overlay), '批改上下文（可选）');
    assert.ok(overlay.innerHTML.includes('跳过'));
    assert.ok(overlay.innerHTML.includes('保存并继续'));

    overlay.querySelector('#ob-skip-ctx').onclick();
    assert.strictEqual(titleOf(overlay), '配置完成！');
    assert.ok(overlay.innerHTML.includes('查看配置'));
    overlay.querySelector('#ob-start').onclick();
    assert.strictEqual(env.store['ai-grading-show-onboarding'], false);
    assert.strictEqual(env.sb.openedSettings, true);
});

test('新试题引导跳过 API 步骤，稍后设置不标记完成', () => {
    const fresh = boot('already-set');
    fresh.sb.showOnboardingDialog(true, 'new-question');
    const overlay = overlayOf(fresh);
    assert.strictEqual(titleOf(overlay), '配置方案');
    assert.ok(!overlay.innerHTML.includes('验证并继续'));

    const skip = boot('');
    skip.sb.showOnboardingDialog(true, 'first-launch');
    const first = overlayOf(skip);
    first.querySelector('#ob-skip').onclick();
    assert.notStrictEqual(skip.store['ai-grading-show-onboarding'], false);
    skip.sb.showOnboardingDialog(true, 'first-launch');
    assert.strictEqual(titleOf(overlayOf(skip)), '欢迎使用 AI 批改助手');
});

test('恢复默认设置会重新打开引导，脚本头仍无官方更新地址', () => {
    const settings = read('src/core/ui-settings.js');
    const resetAt = settings.indexOf("querySelector('#btn-reset-config')");
    const reset = settings.slice(resetAt, resetAt + 900);
    assert.ok(reset.includes("GM_setValue('ai-grading-show-onboarding', true)"));

    const main = read('src/core/main.js');
    assert.ok(main.includes("GM_getValue('ai-grading-show-onboarding', true)"));
    assert.ok(main.includes("showOnboardingDialog(true, 'first-launch')"));
    assert.ok(main.includes("showOnboardingDialog(true, 'new-question')"));
    assert.ok(main.includes('createSettingsPanel({ deferOpen: true })'));

    const build = read('build.js');
    assert.ok(build.includes("name: 'wuy0125爱多分适配版 AI-Marker-Suite'"));
    assert.ok(!build.includes('@downloadURL'));
    assert.ok(!build.includes('@updateURL'));
    assert.ok(read('src/adapters/aiduo/progress-monitor.js').includes('继续阅本题'));
    assert.ok(read('src/adapters/aiduo/adapter.js').includes('requiresManualConfirm: true'));
});
