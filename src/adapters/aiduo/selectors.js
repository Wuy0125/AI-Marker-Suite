// ========== 爱多分（eiduo / xuebanyun）主观题阅卷选择器 ==========
// 平台：安徽学云「爱多分」教师端，学伴云（xuebanyun.com）是同一套壳。
// 登录页：/container/ 与 /container/mobile/（教师自己登录，本适配器不介入）。
// 阅卷壳：https://ui.eiduo.com/exam-webapp/marking/index
//         https://ui.xuebanyun.com/exam-webapp/marking/index
//         抽查页：/exam-webapp/marking/check-index
// 前端：Angular（<demo1-root> / <exam-index> / <exam-submit>），公开构建
//       main-es2015.7c4433cdb0e35e98b7dc.js + chunk 6（2026-11-09 拉取 ui.xuebanyun.com）。
//
// 分数框：exam-submit .submit-bd .item input，placeholder 为「满分」+ 分值，
//         max=满分、min=0。分步打分是「第N步」输入框。评语框、批量排列的
//         #row/#column 不是分数框。
// 提交：exam-submit 内按钮「提交分数」。form ngSubmit 读的是组件模型 e.score，
//       不是只读 input.value。输入事件会在约 0.5–5 秒后自动 submit(true)
//       （debounceSubmit，默认 outTime=1000，且不看「自动提交」开关）。
// 答题图：.img-wrap / .img-content / .imgs 里的 img，src 来自题块 imgUrls。
//         平台自己用「?」前的路径当图身份（dealImages），换卷比较必须去掉 query。
// 回评：header .status.status-remark（文案「当前处于回评模式」）。
// 批量打分：.submit-dashboard.multi。一份分打到多张卡上，本适配器不进入该模式。

const AIDUO_SELECTORS = {
    ROOT: 'exam-index',
    SUBMIT_HOST: 'exam-submit',
    SCORE_INPUT: 'exam-submit .submit-bd .item input',
    SUBMIT_BUTTON_TEXT: '提交分数',
    ANSWER_IMAGE: '.img-wrap img[src], .img-content img[src], .imgs img[src]',
    BATCH_DASHBOARD: 'exam-submit .submit-dashboard.multi',
    REGRADE_FLAG: 'header .status.status-remark, .status.status-remark',
};

function aiduoHostMatches(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/\.+$/, '');
    if (!host) return false;
    return host === 'eiduo.com' || host.endsWith('.eiduo.com')
        || host === 'xuebanyun.com' || host.endsWith('.xuebanyun.com');
}

function aiduoPathMatches(pathname) {
    return /\/exam-webapp\/marking\/(?:index|check-index)\/?$/i.test(String(pathname || ''));
}

function aiduoImageKey(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) return '';
    try {
        const parsed = new URL(trimmed, 'https://ui.eiduo.com');
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
        if (/\/assets\/|help-center|favicon/i.test(parsed.pathname)) return '';
        return parsed.origin + parsed.pathname;
    } catch (e) {
        const bare = trimmed.split('#')[0].split('?')[0];
        if (!bare || /\/assets\/|help-center|favicon/i.test(bare)) return '';
        return bare;
    }
}

function aiduoPaperKey(urls) {
    if (!urls || !urls.length) return '';
    const keys = [];
    for (let i = 0; i < urls.length; i++) {
        const key = aiduoImageKey(urls[i]);
        if (key) keys.push(key);
    }
    return keys.join('|');
}

function aiduoParseMaxScore(placeholder, maxAttr) {
    const fromPlaceholder = String(placeholder || '').match(/满分\s*(\d+(?:\.\d+)?)/);
    if (fromPlaceholder) {
        const value = parseFloat(fromPlaceholder[1]);
        if (Number.isFinite(value) && value > 0) return value;
    }
    if (maxAttr != null && String(maxAttr).trim() !== '') {
        const value = parseFloat(maxAttr);
        if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
}

function aiduoIsScoreInput(el) {
    if (!el || el.disabled || el.type === 'hidden') return false;
    const id = String(el.id || '').toLowerCase();
    if (id === 'row' || id === 'column') return false;
    const placeholder = el.getAttribute ? (el.getAttribute('placeholder') || '') : String(el.placeholder || '');
    if (placeholder.indexOf('评语') !== -1) return false;
    if (placeholder.indexOf('满分') === 0) return true;
    const maxAttr = el.getAttribute ? el.getAttribute('max') : el.max;
    if (maxAttr == null || String(maxAttr).trim() === '') return false;
    const maxValue = parseFloat(maxAttr);
    return Number.isFinite(maxValue) && maxValue > 0;
}

function aiduoScoresMatch(expected, actualText) {
    if (expected == null || !Number.isFinite(Number(expected))) return false;
    const text = actualText == null ? '' : String(actualText).trim();
    if (text === '') return false;
    const actual = Number(text);
    if (!Number.isFinite(actual)) return false;
    return Math.abs(actual - Number(expected)) < 1e-6;
}
