// ========== 配置恢复 ==========
// 在线更新检查已移除。这里只在启动时把缺失的本地配置从备份补回。

/**
 * 获取当前脚本的构建渠道（build-time，由 build.js 注入）。
 */
function getBuildChannel() {
    return (SCRIPT_CONFIG.CHANNEL || 'stable').split('-')[0];
}

/**
 * 获取当前脚本构建渠道的中文标签。
 */
function getBuildChannelLabel() {
    const channel = getBuildChannel();
    if (channel === 'prtest') return '临时测试版';
    const channels = SCRIPT_CONFIG.CHANNELS || {};
    return (channels[channel] || channels.stable || {}).label || '稳定版';
}

/**
 * 检测并恢复配置（更新后首次加载时调用）。
 * 如果主配置丢失但备份存在，自动恢复。
 * 注意：此函数在 PresetManager.init() 之前调用，showToast 可能不可用。
 */
function restoreConfigIfMissing() {
    try {
        const hasPresets = GM_getValue('ai-grading-presets');
        const hasProviders = GM_getValue('ai-grading-providers-v2');
        // 主配置存在，无需恢复
        if (hasPresets && hasProviders) return;

        const backupStr = GM_getValue('ai-grading-config-backup');
        if (!backupStr) return;

        const backup = JSON.parse(backupStr);
        if (!backup.presets && !backup.providers) return;

        console.log('[更新恢复] 检测到配置丢失，发现备份，正在恢复...');
        // 只补缺失键（#293）：绝不覆写现存配置，避免备份后的新改动被回滚
        if (!hasPresets && backup.presets) GM_setValue('ai-grading-presets', backup.presets);
        if (!hasProviders && backup.providers) GM_setValue('ai-grading-providers-v2', backup.providers);
        if (!GM_getValue('ai-grading-workflows') && backup.workflows) GM_setValue('ai-grading-workflows', backup.workflows);
        if (!GM_getValue('ai-grading-channel') && backup.channel) GM_setValue('ai-grading-channel', backup.channel);
        if (GM_getValue('ai-grading-save-images') === undefined && backup.saveImages !== undefined) GM_setValue('ai-grading-save-images', backup.saveImages);

        // 设置标志，让 init() 中显示提示
        sessionStorage.setItem('ai-config-restored', backup.version || 'unknown');
        console.log('[更新恢复] 配置恢复成功');
    } catch (e) {
        console.warn('[更新恢复] 恢复失败:', e.message);
    }
}
