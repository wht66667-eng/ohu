package com.sunshinecampus.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.app.NotificationChannel;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;
import org.json.JSONObject;

/**
 * 番茄专注舱原生能力：
 * - 保持亮屏 / 沉浸式全屏
 * - 系统勿扰（需 ACCESS_NOTIFICATION_POLICY）
 * - 可选屏幕固定（Lock Task）
 * 设置跳转对国产 ROM 做多 Intent 兜底。
 */
@CapacitorPlugin(name = "FocusLock")
public class FocusLockPlugin extends Plugin {
    private int savedSystemUi = -1;
    private boolean keepOn = false;
    private boolean lockTaskOn = false;

    @PluginMethod
    public void consumeNotificationRoute(PluginCall call) {
        JSObject result = new JSObject();
        Activity activity = getActivity();
        String route = activity == null || activity.getIntent() == null ? null : activity.getIntent().getStringExtra("focusNotificationRoute");
        result.put("route", "/study/focus".equals(route) ? route : JSONObject.NULL);
        if (activity != null && activity.getIntent() != null) activity.getIntent().removeExtra("focusNotificationRoute");
        call.resolve(result);
    }

    @PluginMethod
    public void scheduleFocusNotifications(PluginCall call) {
        try {
            JSArray notifications = call.getArray("notifications", new JSArray());
            List<Integer> scheduled = FocusNotificationScheduler.schedule(getContext(), notifications, call.getString("reminder", "sound"));
            JSArray ids = new JSArray();
            for (Integer id : scheduled) ids.put(id);
            JSObject result = new JSObject();
            result.put("scheduledIds", ids);
            result.put("exact", FocusNotificationScheduler.exact(getContext()));
            call.resolve(result);
        } catch (Exception error) {
            FocusNotificationScheduler.cancel(getContext());
            call.reject(error.getMessage() != null ? error.getMessage() : "专注系统提醒安排失败");
        }
    }

    @PluginMethod
    public void cancelFocusNotifications(PluginCall call) {
        FocusNotificationScheduler.cancel(getContext());
        call.resolve();
    }

    @PluginMethod
    public void ensureReminderChannels(PluginCall call) {
        JSArray channels = new JSArray();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) { call.reject("notification manager unavailable"); return; }
            String[] ids = { "sc-focus-sound-v3", "sc-focus-vibrate-v3" };
            for (int index = 0; index < ids.length; index++) {
                NotificationChannel channel = nm.getNotificationChannel(ids[index]);
                if (channel == null) {
                    channel = new NotificationChannel(ids[index], index == 0 ? "专注完成 · 铃声" : "专注完成 · 震动", NotificationManager.IMPORTANCE_HIGH);
                    channel.setDescription("本次专注与休息结束提醒，可在系统设置中调整");
                    channel.enableVibration(true);
                    if (index == 0) {
                        AudioAttributes audio = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build();
                        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), audio);
                    } else channel.setSound(null, null);
                    nm.createNotificationChannel(channel);
                    channel = nm.getNotificationChannel(ids[index]);
                }
                if (channel != null) {
                    JSObject item = new JSObject();
                    item.put("id", channel.getId());
                    item.put("importance", channel.getImportance());
                    item.put("soundAllowed", channel.getSound() != null);
                    item.put("vibration", channel.shouldVibrate());
                    channels.put(item);
                }
            }
        }
        JSObject result = new JSObject();
        result.put("channels", channels);
        call.resolve(result);
    }

    @PluginMethod
    public void hasDndAccess(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasPolicyAccess());
        call.resolve(ret);
    }

    @PluginMethod
    public void openDndAccessSettings(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        Intent[] candidates = new Intent[] {
            new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS),
            detailPolicyIntent(act),
            appDetailsIntent(act),
            new Intent("android.settings.NOTIFICATION_SETTINGS"),
        };
        String opened = startFirstAvailable(act, candidates);
        resolveOpen(call, opened, "无法打开勿扰授权页，请到系统设置搜索「勿扰」");
    }

    @PluginMethod
    public void openDndSettings(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        // 隐藏 API / 各 ROM 实际 Action 字符串不一，按常见顺序尝试
        Intent[] candidates = new Intent[] {
            new Intent("android.settings.ZEN_MODE_SETTINGS"),
            new Intent("android.settings.ZEN_MODE_PRIORITY_SETTINGS"),
            new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS),
            new Intent("android.settings.NOTIFICATION_SETTINGS"),
            new Intent(Settings.ACTION_SOUND_SETTINGS),
            appDetailsIntent(act),
        };
        String opened = startFirstAvailable(act, candidates);
        resolveOpen(call, opened, "无法打开勿扰设置，请到系统设置搜索「勿扰模式」或「专注模式」");
    }

    @PluginMethod
    public void openScreenPinningSettings(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        Intent[] candidates = new Intent[] {
            new Intent("android.settings.LOCK_SCREEN_SETTINGS"),
            new Intent(Settings.ACTION_SECURITY_SETTINGS),
            new Intent(Settings.ACTION_SETTINGS),
            appDetailsIntent(act),
        };
        String opened = startFirstAvailable(act, candidates);
        resolveOpen(call, opened, "无法打开安全设置，请到系统设置搜索「屏幕固定」或「应用固定」");
    }

    /**
     * 一键引导：未授权勿扰 → 打开授权页；已授权 → 打开屏幕固定相关设置。
     * step: auto | dnd | dndDetail | pin
     */
    @PluginMethod
    public void openSetupStep(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        String step = call.getString("step", "auto");
        if (step == null) step = "auto";
        boolean granted = hasPolicyAccess();
        String opened;
        String nextHint;
        if ("dnd".equals(step) || ("auto".equals(step) && !granted)) {
            opened = startFirstAvailable(
                act,
                new Intent[] {
                    new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS),
                    detailPolicyIntent(act),
                    appDetailsIntent(act),
                }
            );
            nextHint = "请找到「哦狐」并打开勿扰/通知策略权限，然后返回 App";
        } else if ("dndDetail".equals(step)) {
            opened = startFirstAvailable(
                act,
                new Intent[] {
                    new Intent("android.settings.ZEN_MODE_SETTINGS"),
                    new Intent("android.settings.ZEN_MODE_PRIORITY_SETTINGS"),
                    new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS),
                    new Intent(Settings.ACTION_SOUND_SETTINGS),
                }
            );
            nextHint = "请在勿扰/专注模式中允许屏蔽通知与来电，然后返回";
        } else {
            opened = startFirstAvailable(
                act,
                new Intent[] {
                    new Intent("android.settings.LOCK_SCREEN_SETTINGS"),
                    new Intent(Settings.ACTION_SECURITY_SETTINGS),
                    new Intent(Settings.ACTION_SETTINGS),
                }
            );
            nextHint = "请开启「屏幕固定」或「应用固定」，然后返回 App";
            step = "pin";
        }
        JSObject ret = new JSObject();
        ret.put("ok", opened != null);
        ret.put("opened", opened != null ? opened : "");
        ret.put("step", step);
        ret.put("hasDndAccess", granted);
        ret.put("hint", nextHint);
        if (opened == null) {
            call.reject(nextHint);
        } else {
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void enterFocus(PluginCall call) {
        boolean wantDnd = Boolean.TRUE.equals(call.getBoolean("dnd", false));
        boolean wantLock = Boolean.TRUE.equals(call.getBoolean("lockTask", false));
        String sessionId = call.getString("sessionId", "");
        Long endsAt = call.getLong("endsAt", 0L);
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        act.runOnUiThread(() -> {
            try {
                act.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                keepOn = true;
                View decor = act.getWindow().getDecorView();
                if (savedSystemUi < 0) savedSystemUi = decor.getSystemUiVisibility();
                int flags =
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
                decor.setSystemUiVisibility(flags);

                boolean dndApplied = FocusSessionGuard.begin(act, sessionId, endsAt, wantDnd);

                boolean lockApplied = false;
                if (wantLock && !lockTaskOn) {
                    try {
                        act.startLockTask();
                        lockTaskOn = true;
                        lockApplied = true;
                    } catch (Throwable ignored) {
                        lockApplied = false;
                    }
                } else if (wantLock) lockApplied = true;

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("dndApplied", dndApplied);
                ret.put("lockApplied", lockApplied);
                ret.put("hasDndAccess", hasPolicyAccess());
                call.resolve(ret);
            } catch (Throwable e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "enterFocus failed");
            }
        });
    }

    @PluginMethod
    public void exitFocus(PluginCall call) {
        FocusSessionGuard.finish(getContext());
        Activity act = getActivity();
        if (act == null) {
            call.resolve();
            return;
        }
        act.runOnUiThread(() -> {
            try {
                if (keepOn) {
                    act.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    keepOn = false;
                }
                View decor = act.getWindow().getDecorView();
                if (savedSystemUi >= 0) {
                    decor.setSystemUiVisibility(savedSystemUi);
                    savedSystemUi = -1;
                } else {
                    decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
                }
                if (lockTaskOn) {
                    try {
                        act.stopLockTask();
                    } catch (Throwable ignored) {
                    }
                    lockTaskOn = false;
                }
            } catch (Throwable ignored) {
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void syncFocusSession(PluginCall call) {
        String sessionId = call.getString("sessionId", "");
        Long endsAt = call.getLong("endsAt", 0L);
        if (sessionId == null || sessionId.isEmpty()) { call.reject("missing sessionId"); return; }
        FocusSessionGuard.sync(getContext(), sessionId, endsAt);
        call.resolve();
    }

    private void resolveOpen(PluginCall call, String opened, String failMsg) {
        JSObject ret = new JSObject();
        if (opened == null) {
            ret.put("ok", false);
            ret.put("opened", "");
            call.reject(failMsg);
            return;
        }
        ret.put("ok", true);
        ret.put("opened", opened);
        ret.put("hasDndAccess", hasPolicyAccess());
        call.resolve(ret);
    }

    private String startFirstAvailable(Activity act, Intent[] candidates) {
        PackageManager pm = act.getPackageManager();
        for (Intent raw : candidates) {
            if (raw == null) continue;
            Intent i = new Intent(raw);
            try {
                if (i.resolveActivity(pm) == null) continue;
                // 从 Activity 启动，不必 NEW_TASK（部分机型加了反而进不去）
                act.startActivity(i);
                String action = i.getAction();
                return action != null ? action : "intent";
            } catch (Throwable ignored) {
                try {
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    if (i.resolveActivity(pm) == null) continue;
                    act.startActivity(i);
                    String action = i.getAction();
                    return action != null ? action : "intent";
                } catch (Throwable ignored2) {
                    /* try next */
                }
            }
        }
        return null;
    }

    private Intent detailPolicyIntent(Activity act) {
        try {
            Intent i = new Intent("android.settings.NOTIFICATION_POLICY_ACCESS_DETAIL_SETTINGS");
            i.setData(Uri.parse("package:" + act.getPackageName()));
            return i;
        } catch (Throwable t) {
            return null;
        }
    }

    private Intent appDetailsIntent(Activity act) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        i.setData(Uri.parse("package:" + act.getPackageName()));
        return i;
    }

    private boolean hasPolicyAccess() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        Context ctx = getContext();
        if (ctx == null) return false;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.isNotificationPolicyAccessGranted();
    }
}
