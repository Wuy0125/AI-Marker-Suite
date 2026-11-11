// ========== 爱多分本题最后一份：点「继续阅本题」 ==========
// 只在适配器确认提交了最后一份之后监视。进度解析不到就不猜、不点。
// 弹窗里两个选项都在时，只点「继续阅本题」，绝不点「阅下一道题」。

function aiduoNormalizeButtonText(text) {
    return String(text || '').replace(/[\s\u00a0\u3000]/g, '');
}

function aiduoParseProgress(text) {
    const compact = aiduoNormalizeButtonText(text).replace(/／/g, '/');
    const matched = compact.match(/阅卷进度[:：](\d+)\/(\d+)/);
    if (!matched) return null;
    const current = parseInt(matched[1], 10);
    const total = parseInt(matched[2], 10);
    if (!Number.isFinite(current) || !Number.isFinite(total)) return null;
    return { current: current, total: total, last: total > 0 && current >= total };
}

function aiduoElementVisible(el) {
    let node = el;
    while (node) {
        if (node.hidden) return false;
        const style = node.style || {};
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        node = node.parentElement;
    }
    return !!el;
}

const AiduoProgress = {
    _timer: null,
    _observer: null,
    _clicked: false,
    _deadline: 0,

    parse: aiduoParseProgress,

    readFromPage() {
        const root = document.body || document.documentElement;
        if (!root) return null;
        return aiduoParseProgress(root.innerText || root.textContent || '');
    },

    noteSubmitted() {
        const progress = this.readFromPage();
        if (!progress || !progress.last) return false;
        this._arm();
        return true;
    },

    stop() {
        if (this._observer) {
            try { this._observer.disconnect(); } catch (e) { /* 观察器可能已拆掉 */ }
            this._observer = null;
        }
        if (this._timer != null) {
            try { clearInterval(this._timer); } catch (e) { /* ignore */ }
            this._timer = null;
        }
        this._deadline = 0;
    },

    _arm() {
        this.stop();
        this._clicked = false;
        this._deadline = Date.now() + 20000;
        this._scan();
        if (this._clicked) return;
        const root = document.body || document.documentElement;
        if (root && typeof MutationObserver === 'function') {
            this._observer = new MutationObserver(() => this._scan());
            try { this._observer.observe(root, { childList: true, subtree: true, characterData: true }); } catch (e) { /* ignore */ }
        }
        if (typeof setInterval === 'function') {
            this._timer = setInterval(() => {
                if (!this._deadline || Date.now() > this._deadline) {
                    this.stop();
                    return;
                }
                this._scan();
            }, 200);
        }
    },

    _stayButton() {
        if (!document.querySelectorAll) return null;
        const nodes = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        let stay = null;
        let next = null;
        nodes.forEach((node) => {
            if (!aiduoElementVisible(node)) return;
            const text = aiduoNormalizeButtonText(node.textContent);
            if (text === '继续阅本题') stay = node;
            else if (text === '阅下一道题') next = node;
        });
        return stay && next ? stay : null;
    },

    _scan() {
        if (this._clicked) return;
        const stay = this._stayButton();
        if (!stay) return;
        this._clicked = true;
        try { stay.click(); } catch (e) { console.warn('[爱多分] 点击继续阅本题失败', e); }
        this.stop();
    },
};
