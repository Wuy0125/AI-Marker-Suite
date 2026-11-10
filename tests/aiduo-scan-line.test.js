// ========== 爱多分答题图扫描线 ==========
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function classList(names) {
    const set = new Set(names || []);
    return {
        contains: (name) => set.has(name),
        add: (name) => set.add(name),
        remove: (name) => set.delete(name),
    };
}

function makeNode(tag, className) {
    const node = {
        tagName: String(tag || 'div').toUpperCase(),
        className: className || '',
        classList: classList(className ? className.split(/\s+/) : []),
        style: {},
        children: [],
        parentElement: null,
        parentNode: null,
        attributes: {},
        setAttribute(key, value) { this.attributes[key] = String(value); },
        getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
        removeAttribute(key) { delete this.attributes[key]; },
        appendChild(child) {
            child.parentElement = this;
            child.parentNode = this;
            this.children.push(child);
            return child;
        },
        removeChild(child) {
            this.children = this.children.filter((item) => item !== child);
            child.parentElement = null;
            child.parentNode = null;
            return child;
        },
        remove() {
            if (this.parentNode && this.parentNode.removeChild) this.parentNode.removeChild(this);
        },
        querySelector(sel) {
            if (sel === '.aiduo-scan-line') {
                return this.children.find((child) => child.className === 'aiduo-scan-line') || null;
            }
            return null;
        },
    };
    return node;
}

function makeSheet(images) {
    const hosts = [];
    const imgs = images.map((src, index) => {
        const kind = index === 1 ? 'img-content' : 'img-wrap';
        const host = makeNode('div', kind);
        const img = makeNode('img');
        img.src = src;
        host.appendChild(img);
        hosts.push(host);
        return img;
    });
    const body = makeNode('body');
    const head = makeNode('head');
    hosts.forEach((host) => body.appendChild(host));
    const observers = [];
    const intervals = [];
    let seq = 1;
    const document = {
        body,
        head,
        documentElement: body,
        getElementById(id) {
            const all = [head, body].concat(head.children, body.children);
            return all.find((node) => node.id === id) || null;
        },
        createElement(tag) {
            const node = makeNode(tag);
            if (tag === 'style') node.id = '';
            return node;
        },
        querySelectorAll() { return imgs.slice(); },
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
        setTimeout() { return 0; },
        clearTimeout() {},
        Array,
    };
    // style id lives on the element after assignment
    const realAppend = head.appendChild.bind(head);
    head.appendChild = (child) => {
        if (child.id) child.attributes.id = child.id;
        return realAppend(child);
    };
    document.getElementById = (id) => head.children.find((node) => node.id === id) || null;
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(read('src/adapters/aiduo/selectors.js'), sb, { filename: 'selectors.js' });
    vm.runInContext(read('src/adapters/aiduo/scan-line.js'), sb, { filename: 'scan-line.js' });
    vm.runInContext(read('src/adapters/aiduo/adapter.js'), sb, { filename: 'adapter.js' });
    vm.runInContext('globalThis.AiduoScanLine = AiduoScanLine; globalThis.AiduoAdapter = AiduoAdapter;', sb);
    return { scan: sb.AiduoScanLine, adapter: sb.AiduoAdapter, hosts, imgs, observers, intervals, document, head };
}

function lines(host) {
    return host.children.filter((child) => child.className === 'aiduo-scan-line');
}

test('开始扫描会在每张答题图上加一条不挡点击的粉线，停止后拆掉', () => {
    const env = makeSheet(['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg']);
    env.scan.start();
    assert.strictEqual(lines(env.hosts[0]).length, 1);
    assert.strictEqual(lines(env.hosts[1]).length, 1);
    const line = lines(env.hosts[0])[0];
    assert.strictEqual(line.style.pointerEvents, 'none');
    assert.strictEqual(line.style.background, '#ff4fa0');
    assert.ok(String(line.style.animation).includes('2s'));
    assert.ok(String(line.style.animation).includes('ease-in-out'));
    assert.ok(String(line.style.animation).includes('alternate'));
    const css = env.document.getElementById('aiduo-scan-style').textContent;
    assert.ok(css.includes('#ff4fa0'));
    assert.ok(css.includes('pointer-events: none'));
    assert.strictEqual(env.hosts[0].style.position, 'relative');
    assert.strictEqual(env.hosts[0].style.overflow, 'hidden');

    env.hosts[0].children = env.hosts[0].children.filter((child) => child.className !== 'aiduo-scan-line');
    env.observers[0].cb();
    assert.strictEqual(lines(env.hosts[0]).length, 1, '图片节点被换掉后要重新挂上扫描线');

    env.scan.stop();
    assert.strictEqual(lines(env.hosts[0]).length, 0);
    assert.strictEqual(lines(env.hosts[1]).length, 0);
    assert.strictEqual(env.document.getElementById('aiduo-scan-style'), null);
    assert.ok(env.observers[0].disconnected);
    assert.ok(env.intervals.every((timer) => timer.cleared));
    assert.strictEqual(env.hosts[0].style.overflow, '');
});

test('出分、失败、暂停都会收起扫描线，下一份再开始', () => {
    const env = makeSheet(['https://cdn.example/a.jpg']);
    env.adapter.onGradingStart();
    assert.strictEqual(lines(env.hosts[0]).length, 1, '开始批改时挂上扫描线');
    env.adapter.onScoresReady();
    assert.strictEqual(lines(env.hosts[0]).length, 0, '写出分数后立刻收起，不必等教师提交');

    env.adapter.onGradingStart();
    assert.strictEqual(lines(env.hosts[0]).length, 1, '下一份开始时重新扫描');
    env.adapter.onGradingEnd();
    assert.strictEqual(lines(env.hosts[0]).length, 0, '失败、暂停或离开页面时收起');
});

test('核心在送 AI、出分、失败、暂停和离开页面时通知当前适配器', () => {
    const main = read('src/core/main.js');
    const button = read('src/core/ui-button.js');
    assert.ok(main.includes("notifyAdapterHook('onGradingStart')"), '送 AI 前要开始扫描');
    assert.ok(main.includes("notifyAdapterHook('onScoresReady')"), '写出分数后要收起扫描');
    assert.ok(main.includes("notifyAdapterHook('onGradingEnd')"), '本份失败要收起扫描');
    assert.ok(button.includes("notifyAdapterHook('onGradingEnd')"), '暂停和停止要收起扫描');
});
