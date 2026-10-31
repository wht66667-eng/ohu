package com.sunshinecampus.app;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 多邻国式桌面图标变脸：
 * - setIcon：立刻切换 activity-alias
 * - syncMood：写入原生活跃日 + 切换图标 + 挂后台定时变脸
 */
@CapacitorPlugin(name = "LauncherIcon")
public class LauncherIconPlugin extends Plugin {

    private void resolve(PluginCall call, boolean ok, String name) {
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        ret.put("enabled", IconMoodPrefs.isEnabled(getContext()));
        ret.put("name", name);
        ret.put("pending", LauncherIconSwitcher.isPending());
        if (!ok) ret.put("error", IconMoodPrefs.lastError(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void setIcon(PluginCall call) {
        String name = call.getString("name", "default");
        /* 工作端固定默认满幅图标，不切换 away 态 */
        if (!"user".equals(BuildConfig.SC_SHELL)) {
            name = "default";
        }
        if (!IconMoodPrefs.isEnabled(getContext()) && !"default".equals(name)) {
            IconMoodPrefs.setError(getContext(), "请先在设置中开启桌面图标变脸");
            resolve(call, false, "default");
            return;
        }
        boolean ok = LauncherIconSwitcher.apply(getContext(), name);
        if (ok) ok = IconMoodScheduler.ensure(getContext());
        resolve(call, ok, name);
    }

    /**
     * 变脸总开关（仅设置页主动开启）：
     * 关 = 取消后台任务 + 恢复默认图标；开 = 恢复记录的图标并重新挂任务。
     */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (!"user".equals(BuildConfig.SC_SHELL)) {
            IconMoodPrefs.setEnabled(getContext(), false);
            IconMoodScheduler.cancel(getContext());
            IconMoodPrefs.setError(getContext(), "此安装版本不支持桌面图标变脸");
            resolve(call, !enabled, "default");
            return;
        }
        IconMoodPrefs.setEnabled(getContext(), enabled);
        boolean ok;
        String name = enabled ? IconMoodPrefs.iconState(getContext()) : "default";
        if (enabled) {
            ok = IconMoodScheduler.ensure(getContext());
            if (ok) ok = LauncherIconSwitcher.apply(getContext(), name);
            if (!ok) {
                String error = IconMoodPrefs.lastError(getContext());
                IconMoodPrefs.setEnabled(getContext(), false);
                IconMoodScheduler.cancel(getContext());
                LauncherIconSwitcher.apply(getContext(), "default");
                IconMoodPrefs.setError(getContext(), error);
            }
        } else {
            boolean cancelled = IconMoodScheduler.cancel(getContext());
            String error = IconMoodPrefs.lastError(getContext());
            ok = LauncherIconSwitcher.apply(getContext(), "default") && cancelled;
            if (!cancelled) IconMoodPrefs.setError(getContext(), error);
        }
        resolve(call, ok, name);
    }

    /**
     * 前端打卡/进门后调用。后台 Worker 只读这些字段，不依赖 WebView。
     * lastActiveDate / lastCheckinDate: YYYY-MM-DD
     */
    @PluginMethod
    public void syncMood(PluginCall call) {
        if (!"user".equals(BuildConfig.SC_SHELL)) {
            boolean ok = LauncherIconSwitcher.apply(getContext(), "default");
            JSObject ret = new JSObject();
            ret.put("ok", ok);
            ret.put("name", "default");
            ret.put("awayHint", 0);
            call.resolve(ret);
            return;
        }
        String lastActive = call.getString("lastActiveDate", IconMoodPrefs.today());
        String lastCheckin = call.getString("lastCheckinDate", "");
        int streak = call.getInt("streakCurrent", 0);
        String icon = call.getString("iconState", null);
        if (icon == null || icon.isEmpty()) {
            icon = LauncherIconSwitcher.resolve(lastActive, lastCheckin, streak);
        }
        IconMoodPrefs.save(getContext(), lastActive, lastCheckin, streak, icon);
        /* 关闭时也更新活跃记录；旧图标恢复默认，不安排后台任务。 */
        if (!IconMoodPrefs.isEnabled(getContext())) {
            boolean cancelled = IconMoodScheduler.cancel(getContext());
            String error = IconMoodPrefs.lastError(getContext());
            boolean applied = LauncherIconSwitcher.apply(getContext(), "default");
            if (!cancelled) IconMoodPrefs.setError(getContext(), error);
            resolve(call, applied && cancelled, "default");
            return;
        }
        boolean ok = LauncherIconSwitcher.apply(getContext(), icon);
        if (ok) ok = IconMoodScheduler.ensure(getContext());
        resolve(call, ok, icon);
    }

    @PluginMethod
    public void resetMood(PluginCall call) {
        IconMoodPrefs.save(getContext(), "", "", 0, "default");
        boolean cancelled = IconMoodScheduler.cancel(getContext());
        String error = IconMoodPrefs.lastError(getContext());
        boolean applied = LauncherIconSwitcher.apply(getContext(), "default");
        if (!cancelled) IconMoodPrefs.setError(getContext(), error);
        resolve(call, applied && cancelled, "default");
    }

    @PluginMethod
    public void getIcon(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        String pkg = getContext().getPackageName();
        String found = "default";
        for (String a : LauncherIconSwitcher.ALIASES) {
            ComponentName cn = new ComponentName(pkg, pkg + "." + a);
            int st = pm.getComponentEnabledSetting(cn);
            if (st == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                if (a.equals("LauncherDefault")) found = "default";
                else if (a.startsWith("LauncherStreak")) found = "streak_" + a.replace("LauncherStreak", "");
                else if (a.startsWith("LauncherAway")) found = "away_" + a.replace("LauncherAway", "");
                break;
            }
        }
        JSObject ret = new JSObject();
        ret.put("name", found);
        ret.put("pending", LauncherIconSwitcher.isPending());
        String error = IconMoodPrefs.lastError(getContext());
        if (!error.isEmpty()) ret.put("error", error);
        call.resolve(ret);
    }
}
