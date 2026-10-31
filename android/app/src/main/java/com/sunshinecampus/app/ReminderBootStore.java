package com.sunshinecampus.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import org.json.JSONObject;

/** Persisted boot recovery preference. Does not start a service or a foreground activity. */
final class ReminderBootStore {
    // The patched LocalNotificationRestoreReceiver reads this exact store/key contract.
    private static final String STORE = "reminder.boot.v1";
    private static final String LOCAL_RESTORE = "com.capacitorjs.plugins.localnotifications.LocalNotificationRestoreReceiver";
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences(STORE, Context.MODE_PRIVATE); }
    static String owner(Context context) { return prefs(context).getString("ownerUid", ""); }
    static boolean enabled(Context context) { return prefs(context).getBoolean("enabled", true); }
    static boolean allows(Context context, String planOwner) {
        return enabled(context) && planOwner != null && !planOwner.isEmpty() && planOwner.equals(owner(context));
    }
    static synchronized JSObject state(Context context) {
        JSObject result = new JSObject(); String owner = owner(context), error = prefs(context).getString("lastError", "");
        result.put("supported", true); result.put("enabled", enabled(context));
        result.put("ownerUid", owner.isEmpty() ? JSONObject.NULL : owner);
        result.put("lastError", error.isEmpty() ? JSONObject.NULL : error);
        return result;
    }
    static synchronized JSObject selectOwner(Context context, String uid) {
        validateOwner(uid);
        if (uid.equals(owner(context))) return state(context);
        if (!owner(context).isEmpty()) ReminderPlanStore.clear(context, owner(context));
        boolean preference = prefs(context).getBoolean("choice." + uid, true);
        if (!prefs(context).edit().putString("ownerUid", uid).putBoolean("enabled", preference).putString("lastError", "").commit()) throw new IllegalStateException("无法保存开机恢复账户");
        configureReceiver(context, preference);
        return state(context);
    }
    static synchronized JSObject setEnabled(Context context, String expectedOwner, boolean value) {
        validateOwner(expectedOwner);
        if (!expectedOwner.equals(owner(context))) throw new IllegalStateException("账号已变化，请重新操作");
        if (!prefs(context).edit().putBoolean("enabled", value).putBoolean("choice." + expectedOwner, value).putString("lastError", "").commit()) throw new IllegalStateException("无法保存开机恢复设置");
        configureReceiver(context, value);
        if (value) {
            // Explicit restoration uses the same filtered receiver path as BOOT_COMPLETED.
            context.sendBroadcast(new Intent("com.sunshinecampus.RESTORE_REMINDERS").setComponent(new ComponentName(context.getPackageName(), LOCAL_RESTORE)));
            if (allows(context, ReminderOverlayStore.owner(context))) ReminderOverlayStore.restore(context);
            if (allows(context, ReminderPlanStore.owner(context))) ReminderPlanStore.resume(context);
        }
        return state(context);
    }
    static synchronized JSObject clearOwner(Context context, String expectedOwner) {
        if (expectedOwner == null || expectedOwner.isEmpty() || !expectedOwner.equals(owner(context))) return state(context);
        ReminderPlanStore.clear(context, expectedOwner);
        // Retain each account's switch choice, but no signed-out private plans may recover.
        if (!prefs(context).edit().remove("ownerUid").putBoolean("enabled", false).putString("lastError", "").commit()) throw new IllegalStateException("无法清除开机恢复账户");
        configureReceiver(context, false);
        return state(context);
    }
    private static void validateOwner(String uid) {
        if (uid == null || uid.trim().isEmpty() || uid.length() > 128) throw new IllegalArgumentException("开机恢复账户无效");
    }
    private static void configureReceiver(Context context, boolean on) {
        try {
            context.getPackageManager().setComponentEnabledSetting(new ComponentName(context.getPackageName(), LOCAL_RESTORE), on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        } catch (RuntimeException failure) {
            prefs(context).edit().putString("lastError", "系统未能更新开机恢复入口，请重新操作").commit();
            throw failure;
        }
    }
}
