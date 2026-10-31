package com.sunshinecampus.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 常驻提醒守护 + 系统设置跳转。
 *
 * start / stop：启停 KeepAliveService 前台服务（常驻通知）。
 * isRunning：进程内运行标志。
 * 其余为「提醒权限体检」所需的系统设置跳转与状态查询：
 * - openNotificationSettings：本 App 通知管理页（渠道列表，可开悬浮/锁屏/角标）
 * - openChannelSettings：指定通知渠道详情页
 * - isBatteryOptimizationIgnored / openBatteryOptimization：电池优化豁免
 * - openAutostartGuide：国产 ROM 自启动管理页（多 Intent 兜底）
 * - openAppDetails：系统应用信息页（兜底入口）
 *
 * 跳转对国产 ROM 做多 Intent 兜底，全部失败则回退到应用详情页，
 * 与 FocusLockPlugin 的策略一致。
 */
@CapacitorPlugin(name = "KeepAlive")
public class KeepAlivePlugin extends Plugin {

    /* ---------------- 前台服务 ---------------- */

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("no context");
            return;
        }
        if (AdminShellReminderCleanup.enforce(ctx)) {
            call.reject("管理端使用独立工作通知，无需开启学生提醒守护");
            return;
        }
        // 常驻通知本身要能显示，才有「挂一条通知」的意义；没有通知权限就明确拒绝。
        if (!KeepAliveService.canPostNotifications(ctx)) {
            call.reject("请先允许通知权限，常驻提醒才能显示");
            return;
        }
        if (!startForeground(ctx, call.getString("title", "哦狐提醒守护中"), call.getString("text", ""))) {
            call.reject("开启常驻提醒失败，请稍后重试");
            return;
        }
        setWanted(ctx, true);
        JSObject ret = new JSObject();
        ret.put("running", KeepAliveService.running);
        call.resolve(ret);
    }

    /** Automatic recovery must respect an opt-out made from the system notification. */
    @PluginMethod
    public void restore(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) { call.reject("no context"); return; }
        if (AdminShellReminderCleanup.enforce(ctx)) {
            JSObject ret = new JSObject(); ret.put("wanted", false); ret.put("running", false); call.resolve(ret); return;
        }
        android.content.SharedPreferences prefs = ctx.getSharedPreferences(KeepAliveBootReceiver.PREFS, Context.MODE_PRIVATE);
        // Migrate the web preference once. A stored native false is an explicit user choice.
        if (!prefs.contains(KeepAliveBootReceiver.KEY_WANTED)
            && !prefs.edit().putBoolean(KeepAliveBootReceiver.KEY_WANTED, call.getBoolean("defaultWanted", true)).commit()) {
            call.reject("无法保存常驻提醒设置"); return;
        }
        boolean wanted = prefs.getBoolean(KeepAliveBootReceiver.KEY_WANTED, false);
        if (wanted) {
            if (!KeepAliveService.canPostNotifications(ctx)) { call.reject("请先允许通知权限，常驻提醒才能显示"); return; }
            if (!startForeground(ctx, call.getString("title", "哦狐提醒守护中"), call.getString("text", ""), true)) {
                call.reject("恢复常驻提醒失败，请稍后重试"); return;
            }
        }
        JSObject ret = new JSObject();
        ret.put("wanted", prefs.getBoolean(KeepAliveBootReceiver.KEY_WANTED, false));
        ret.put("running", KeepAliveService.running);
        call.resolve(ret);
    }

    /** 只刷新常驻通知上的文案；服务没在跑时不擅自拉起。 */
    @PluginMethod
    public void update(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("no context");
            return;
        }
        if (!KeepAliveService.running) {
            JSObject ret = new JSObject();
            ret.put("running", false);
            call.resolve(ret);
            return;
        }
        if (!startForeground(ctx, call.getString("title", "哦狐提醒守护中"), call.getString("text", ""), true)) {
            call.reject("更新常驻提醒失败，请稍后重试");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("running", KeepAliveService.running);
        call.resolve(ret);
    }

    private boolean startForeground(Context ctx, String title, String text) {
        return startForeground(ctx, title, text, false);
    }

    private boolean startForeground(Context ctx, String title, String text, boolean restoreOnlyIfWanted) {
        try {
            Intent intent = new Intent(ctx, KeepAliveService.class);
            intent.putExtra(KeepAliveService.EXTRA_TITLE, title);
            intent.putExtra(KeepAliveService.EXTRA_TEXT, text);
            intent.putExtra(KeepAliveService.EXTRA_RESTORE_ONLY_IF_WANTED, restoreOnlyIfWanted);
            // 立即前台化，避免 startForegroundService 的 5 秒窗口被系统判定为 ANR。
            ContextCompat.startForegroundService(ctx, intent);
            return true;
        } catch (RuntimeException error) {
            return false;
        }
    }

    /** 记下用户是否想要常驻提醒：开机重启时 KeepAliveBootReceiver 靠它决定要不要挂回去。 */
    private void setWanted(Context ctx, boolean wanted) {
        try {
            ctx.getSharedPreferences(KeepAliveBootReceiver.PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KeepAliveBootReceiver.KEY_WANTED, wanted)
                .apply();
        } catch (Throwable ignored) {
            /* 偏好写入失败只影响开机恢复，不影响当前会话 */
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("no context");
            return;
        }
        try {
            // Stop directly: starting a service just to stop it can violate background-start restrictions.
            ctx.stopService(new Intent(ctx, KeepAliveService.class));
        } catch (RuntimeException error) {
            call.reject("停止旧提醒服务失败：" + error.getMessage());
            return;
        }
        setWanted(ctx, false);
        KeepAliveService.cancelStandalone(ctx);
        JSObject ret = new JSObject();
        ret.put("running", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", KeepAliveService.running);
        Context ctx = getContext();
        android.content.SharedPreferences prefs = ctx == null ? null : ctx.getSharedPreferences(KeepAliveBootReceiver.PREFS, Context.MODE_PRIVATE);
        ret.put("wanted", prefs != null && prefs.contains(KeepAliveBootReceiver.KEY_WANTED)
            ? prefs.getBoolean(KeepAliveBootReceiver.KEY_WANTED, false) : org.json.JSONObject.NULL);
        call.resolve(ret);
    }

    /* ---------------- 电池优化 ---------------- */

    @PluginMethod
    public void isBatteryOptimizationIgnored(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        boolean ignored = true;
        if (ctx != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            ignored = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        }
        ret.put("ignored", ignored);
        call.resolve(ret);
    }

    @PluginMethod
    public void openBatteryOptimization(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        String pkg = act.getPackageName();
        Intent[] candidates = new Intent[2];
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            candidates[0] = new Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + pkg)
            );
            candidates[1] = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        } else {
            candidates[0] = appDetailsIntent(act);
            candidates[1] = new Intent(Settings.ACTION_SETTINGS);
        }
        String opened = startFirstAvailable(act, candidates);
        resolveOpen(call, opened, "无法打开电池设置，请在系统设置中搜索「电池优化」");
    }

    /* ---------------- 通知设置 ---------------- */

    /** Read the current OS state without requesting access or changing sound/volume. */
    @PluginMethod
    public void getReminderPermissionState(PluginCall call) {
        try { call.resolve(ReminderNotificationSettings.state(getContext(), call.getString("channelId", ""))); }
        catch (RuntimeException error) { call.reject(error.getMessage()); }
    }

    /** Only explicitly selected course sound/vibration combinations can create a new channel. */
    @PluginMethod
    public void ensureReminderChannel(PluginCall call) {
        try {
            call.resolve(ReminderNotificationSettings.ensureChannel(getContext(), call.getString("id"),
                call.getString("name"), call.getString("description", ""), call.getInt("importance"),
                call.getInt("visibility", 1), call.getBoolean("vibration"), call.getBoolean("soundEnabled")));
        } catch (RuntimeException error) { call.reject(error.getMessage()); }
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        Intent primary;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            primary = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, act.getPackageName());
        } else {
            primary = new Intent("android.settings.APP_NOTIFICATION_SETTINGS")
                .putExtra("app_package", act.getPackageName())
                .putExtra("app_uid", act.getApplicationInfo().uid);
        }
        Intent[] candidates = new Intent[] { primary, appDetailsIntent(act) };
        String opened = startFirstAvailable(act, candidates);
        resolveOpen(call, opened, "无法打开通知设置");
    }

    @PluginMethod
    public void openChannelSettings(PluginCall call) {
        Activity act = getActivity();
        String channelId = call.getString("channelId", "");
        if (act == null) {
            call.reject("no activity");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || channelId.isEmpty()) {
            openNotificationSettings(call);
            return;
        }
        Intent[] candidates = new Intent[] {
            new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, act.getPackageName())
                .putExtra(Settings.EXTRA_CHANNEL_ID, channelId),
            new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, act.getPackageName()),
            appDetailsIntent(act),
        };
        String opened = startFirstAvailable(act, candidates);
        resolveOpen(call, opened, "无法打开渠道设置");
    }

    /* ---------------- 自启动引导 ---------------- */

    @PluginMethod
    public void openAutostartGuide(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        String pkg = act.getPackageName();
        Intent[] candidates = new Intent[] {
            /* 小米 / Redmi */
            new Intent().setClassName(
                "com.miui.securitycenter",
                "com.miui.permcenter.autostart.AutoStartManagementActivity"
            ),
            /* 华为 */
            new Intent().setClassName(
                "com.huawei.systemmanager",
                "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"
            ),
            new Intent().setClassName(
                "com.huawei.systemmanager",
                "com.huawei.systemmanager.optimize.process.ProtectActivity"
            ),
            /* OPPO */
            new Intent().setClassName(
                "com.coloros.safecenter",
                "com.coloros.safecenter.permission.startup.StartupAppListActivity"
            ),
            new Intent().setClassName(
                "com.coloros.safecenter",
                "com.coloros.safecenter.startupapp.StartupAppListActivity"
            ),
            /* vivo */
            new Intent().setClassName(
                "com.vivo.permissionmanager",
                "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"
            ),
            /* 荣耀 */
            new Intent().setClassName(
                "com.hihonor.systemmanager",
                "com.hihonor.systemmanager.optimize.process.ProtectActivity"
            ),
            /* 通用电池设置兜底 */
            new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            appDetailsIntent(act),
        };
        String opened = startFirstAvailable(act, candidates);
        resolveOpen(call, opened, "请手动在系统设置中允许本 App 自启动");
    }

    /* ---------------- 应用详情 ---------------- */

    @PluginMethod
    public void openAppDetails(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        String opened = startFirstAvailable(act, new Intent[] {
            appDetailsIntent(act),
            new Intent(Settings.ACTION_SETTINGS),
        });
        resolveOpen(call, opened, "无法打开应用信息页");
    }

    /* ---------------- 工具 ---------------- */

    private Intent appDetailsIntent(Context ctx) {
        return new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + ctx.getPackageName())
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private String startFirstAvailable(Context ctx, Intent[] intents) {
        for (Intent intent : intents) {
            if (intent == null) continue;
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                String action = intent.getAction();
                return action != null ? action : intent.toString();
            } catch (ActivityNotFoundException | SecurityException ignored) {
                /* 尝试下一个 */
            } catch (Throwable ignored) {
                /* 厂商 ROM 私有 Activity 可能抛任意异常，继续兜底 */
            }
        }
        return null;
    }

    private void resolveOpen(PluginCall call, String opened, String failMsg) {
        if (opened != null) {
            JSObject ret = new JSObject();
            ret.put("opened", opened);
            call.resolve(ret);
        } else {
            call.reject(failMsg);
        }
    }
}
