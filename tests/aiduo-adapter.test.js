// 爱多分适配器的纯函数回归：主机/路径要窄，换卷不能被 query 骗到，0 分是合法分。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadAiduo() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'adapters', 'aiduo', 'selectors.js'), 'utf8');
    const sandbox = { console, URL, Number, String };
    vm.createContext(sandbox);
    vm.runInContext(src + `
        this.__aiduo = {
            aiduoHostMatches,
            aiduoPathMatches,
            aiduoImageKey,
            aiduoPaperKey,
            aiduoParseMaxScore,
            aiduoIsScoreInput,
            aiduoScoresMatch,
        };
    `, sandbox);
    return sandbox.__aiduo;
}

const aiduo = loadAiduo();

test('只匹配爱多分与学伴云主机', () => {
    assert.equal(aiduo.aiduoHostMatches('ui.eiduo.com'), true);
    assert.equal(aiduo.aiduoHostMatches('www.eiduo.com'), true);
    assert.equal(aiduo.aiduoHostMatches('eiduo.com'), true);
    assert.equal(aiduo.aiduoHostMatches('UI.XUEBANYUN.COM'), true);
    assert.equal(aiduo.aiduoHostMatches('www.xuebanyun.com'), true);
    assert.equal(aiduo.aiduoHostMatches('eiduo.com.evil.example'), false);
    assert.equal(aiduo.aiduoHostMatches('not-eiduo.com'), false);
    assert.equal(aiduo.aiduoHostMatches('xuebanyun.com.attacker.test'), false);
    assert.equal(aiduo.aiduoHostMatches(''), false);
});

test('只匹配主观题阅卷路径，不匹配登录页', () => {
    assert.equal(aiduo.aiduoPathMatches('/exam-webapp/marking/index'), true);
    assert.equal(aiduo.aiduoPathMatches('/exam-webapp/marking/index/'), true);
    assert.equal(aiduo.aiduoPathMatches('/exam-webapp/marking/check-index'), true);
    assert.equal(aiduo.aiduoPathMatches('/container/mobile/'), false);
    assert.equal(aiduo.aiduoPathMatches('/container/'), false);
    assert.equal(aiduo.aiduoPathMatches('/exam-webapp/exam-manage/index'), false);
    assert.equal(aiduo.aiduoPathMatches('/exam-webapp/marking/index/extra'), false);
});

test('答题图身份去掉 query，并丢掉图标和 data/blob', () => {
    const a = aiduo.aiduoImageKey('https://img.example.com/cut/stu1.jpg?t=1&x-oss-process=crop');
    const b = aiduo.aiduoImageKey('https://img.example.com/cut/stu1.jpg?t=2');
    const c = aiduo.aiduoImageKey('https://img.example.com/cut/stu2.jpg?t=2');
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(aiduo.aiduoImageKey('data:image/png;base64,aaaa'), '');
    assert.equal(aiduo.aiduoImageKey('blob:https://ui.eiduo.com/1111'), '');
    assert.equal(aiduo.aiduoImageKey('https://ui.eiduo.com/exam-webapp/assets/images/help-center/plyj/1.png'), '');
    assert.equal(aiduo.aiduoPaperKey([a, c]), a + '|' + c);
});

test('满分从 placeholder 读取，读不到就是 0', () => {
    assert.equal(aiduo.aiduoParseMaxScore('满分12', null), 12);
    assert.equal(aiduo.aiduoParseMaxScore('满分12.5', '4'), 12.5);
    assert.equal(aiduo.aiduoParseMaxScore('', '8'), 8);
    assert.equal(aiduo.aiduoParseMaxScore('请输入评语', ''), 0);
    assert.equal(aiduo.aiduoParseMaxScore('', ''), 0);
});

test('分数框排除评语和批量排列框', () => {
    assert.equal(aiduo.aiduoIsScoreInput({
        disabled: false,
        id: '',
        getAttribute: name => (name === 'placeholder' ? '满分8' : null),
    }), true);
    assert.equal(aiduo.aiduoIsScoreInput({
        disabled: true,
        id: '',
        getAttribute: () => '满分8',
    }), false);
    assert.equal(aiduo.aiduoIsScoreInput({
        disabled: false,
        id: 'row',
        getAttribute: () => '满分8',
    }), false);
    assert.equal(aiduo.aiduoIsScoreInput({
        disabled: false,
        id: '',
        getAttribute: name => (name === 'placeholder' ? '请输入评语' : null),
    }), false);
});

test('0 分是合法分，空字符串不是', () => {
    assert.equal(aiduo.aiduoScoresMatch(0, '0'), true);
    assert.equal(aiduo.aiduoScoresMatch(0, ''), false);
    assert.equal(aiduo.aiduoScoresMatch(1.5, '1.50'), true);
    assert.equal(aiduo.aiduoScoresMatch(8, '8.1'), false);
    assert.equal(aiduo.aiduoScoresMatch(null, '0'), false);
});
