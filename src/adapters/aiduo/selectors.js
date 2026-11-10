// ========== 爱多分阅卷 DOM 选择器 ==========
// ui.eiduo.com / *.xuebanyun.com — Angular exam-webapp
// 阅卷路由：/exam-webapp/marking/index 与 /exam-webapp/marking/check-index
// 页面可能带路径前缀，或把 marking 放在 hash 路由里。

const AIDUO_SELECTORS = {
    // 分数框：exam-submit 里每个给分项的输入框（placeholder 常为「满分N」）
    SCORE_INPUT: 'exam-submit .submit-bd .item input',

    // 提交区根节点，里面找文字为「提交分数」的按钮
    SUBMIT_ROOT: 'exam-submit',

    // 批量打分开启时出现；一份分数会打到多张卡
    BATCH_FLAG: 'exam-submit .submit-mult',

    // 抽查/回评状态条
    REGRADE_STATUS: 'header .status.status-remark, .status.status-remark',

    // 页面级阅卷组件（isMultScore / multTopic）
    EXAM_INDEX: 'exam-index',

    // 答题图。签名、裁切参数在查询串里，比对时要丢掉
    ANSWER_IMAGE: '.img-wrap img[src], .img-content img[src], .imgs img[src]',
};
