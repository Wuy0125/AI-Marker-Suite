// ========== 爱多分答题图扫描线 ==========
// 只盖在答题图的 .img-wrap / .img-content / .imgs 上。
// 批改开始时出现，出分或失败、暂停、离开页面时立刻拆掉。

const AIDUO_SCAN_STYLE_ID = 'aiduo-scan-style';

function aiduoHasClass(node, name) {
    if (!node) return false;
    if (node.classList && typeof node.classList.contains === 'function' && node.classList.contains(name)) return true;
    return String(node.className || '').split(/\s+/).indexOf(name) !== -1;
}

const AiduoScanLine = {
    _active: false,
    _observer: null,
    _timer: null,
    _hosts: [],

    start() {
        this._active = true;
        this._ensureStyle();
        this._attachAll();
        this._watch();
    },

    stop() {
        this._active = false;
        if (this._observer) {
            try { this._observer.disconnect(); } catch (e) { /* 观察器可能已拆掉 */ }
            this._observer = null;
        }
        if (this._timer != null) {
            try { clearInterval(this._timer); } catch (e) { /* ignore */ }
            this._timer = null;
        }
        this._removeAll();
        const style = document.getElementById(AIDUO_SCAN_STYLE_ID);
        if (style && style.parentNode) style.parentNode.removeChild(style);
    },

    _ensureStyle() {
        if (document.getElementById(AIDUO_SCAN_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = AIDUO_SCAN_STYLE_ID;
        style.textContent = [
            '@keyframes aiduo-scan-sweep {',
            '  from { top: 0; }',
            '  to { top: calc(100% - 3px); }',
            '}',
            '.aiduo-scan-line {',
            '  position: absolute;',
            '  left: 0; right: 0; top: 0;',
            '  height: 3px;',
            '  background: #ff4fa0;',
            '  box-shadow: 0 0 8px 2px rgba(255, 79, 160, 0.9), 0 0 18px 6px rgba(255, 79, 160, 0.45);',
            '  pointer-events: none;',
            '  z-index: 5;',
            '  animation: aiduo-scan-sweep 2s ease-in-out infinite alternate;',
            '}',
        ].join('\n');
        const parent = document.head || document.documentElement;
        if (parent) parent.appendChild(style);
    },

    _hostFor(img) {
        let node = img && img.parentElement;
        while (node) {
            if (aiduoHasClass(node, 'img-wrap') || aiduoHasClass(node, 'img-content') || aiduoHasClass(node, 'imgs')) {
                return node;
            }
            node = node.parentElement;
        }
        return null;
    },

    _lineOf(host) {
        if (!host || typeof host.querySelector !== 'function') return null;
        return host.querySelector('.aiduo-scan-line');
    },

    _ensureLine(host) {
        if (!host || this._lineOf(host)) return;
        if (!host.getAttribute || host.getAttribute('data-aiduo-scan-host') !== '1') {
            host.__aiduoPrevStyle = {
                position: host.style ? (host.style.position || '') : '',
                overflow: host.style ? (host.style.overflow || '') : '',
            };
            if (host.style) {
                if (!host.style.position || host.style.position === 'static') host.style.position = 'relative';
                host.style.overflow = 'hidden';
            }
            if (host.setAttribute) host.setAttribute('data-aiduo-scan-host', '1');
        }
        const line = document.createElement('div');
        line.className = 'aiduo-scan-line';
        if (line.setAttribute) line.setAttribute('data-aiduo-scan-line', '1');
        line.style.pointerEvents = 'none';
        line.style.position = 'absolute';
        line.style.left = '0';
        line.style.right = '0';
        line.style.height = '3px';
        line.style.background = '#ff4fa0';
        line.style.boxShadow = '0 0 8px 2px rgba(255, 79, 160, 0.9), 0 0 18px 6px rgba(255, 79, 160, 0.45)';
        line.style.animation = 'aiduo-scan-sweep 2s ease-in-out infinite alternate';
        line.style.zIndex = '5';
        host.appendChild(line);
        if (this._hosts.indexOf(host) === -1) this._hosts.push(host);
    },

    _attachAll() {
        if (!this._active || !document.querySelectorAll) return;
        const images = Array.from(document.querySelectorAll(AIDUO_SELECTORS.ANSWER_IMAGE));
        const seen = [];
        images.forEach((img) => {
            const host = this._hostFor(img);
            if (!host) return;
            if (seen.indexOf(host) === -1) seen.push(host);
            this._ensureLine(host);
        });
        this._hosts.slice().forEach((host) => {
            if (seen.indexOf(host) === -1) this._clearHost(host);
        });
    },

    _clearHost(host) {
        const line = this._lineOf(host);
        if (line && typeof line.remove === 'function') line.remove();
        else if (line && line.parentNode && line.parentNode.removeChild) line.parentNode.removeChild(line);
        if (host && host.__aiduoPrevStyle && host.style) {
            host.style.position = host.__aiduoPrevStyle.position;
            host.style.overflow = host.__aiduoPrevStyle.overflow;
            host.__aiduoPrevStyle = null;
        }
        if (host && host.removeAttribute) host.removeAttribute('data-aiduo-scan-host');
        this._hosts = this._hosts.filter((item) => item !== host);
    },

    _removeAll() {
        this._hosts.slice().forEach((host) => this._clearHost(host));
        this._hosts = [];
    },

    _watch() {
        if (!this._observer && typeof MutationObserver === 'function') {
            const root = document.body || document.documentElement;
            if (root) {
                this._observer = new MutationObserver(() => {
                    if (this._active) this._attachAll();
                });
                this._observer.observe(root, { childList: true, subtree: true });
            }
        }
        if (this._timer == null && typeof setInterval === 'function') {
            this._timer = setInterval(() => {
                if (this._active) this._attachAll();
            }, 400);
        }
    },
};
