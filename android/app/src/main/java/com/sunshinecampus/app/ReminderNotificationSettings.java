package com.sunshinecampus.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.Vibrator;
import android.os.VibratorManager;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** User-selected course channels and read-only system diagnostics. No permission or volume mutations. */
final class ReminderNotificationSettings {
    private static final Pattern COURSE_CHANNEL = Pattern.compile("^class-remind-(normal|quiet|important)-s([01])v([01])-v4$");

    private ReminderNotificationSettings() {}

    static JSObject ensureChannel(Context context, String id, String name, String description,
                                  Integer importance, Integer visibility, Boolean vibration, Boolean soundEnabled) {
        if (context == null) throw new IllegalStateException("系统环境不可用");
        Matcher match = COURSE_CHANNEL.matcher(id == null ? "" : id);
        if (!match.matches() || vibration == null || soundEnabled == null
            || !match.group(2).equals(soundEnabled ? "1" : "0") || !match.group(3).equals(vibration ? "1" : "0")
            || name == null || name.trim().isEmpty() || name.length() > 100
            || description == null || description.length() > 500
            || importance == null || importance < 2 || importance > 4
            || visibility == null || visibility < -1 || visibility > 1
            || ((soundEnabled || vibration) && importance < 3)) {
            throw new IllegalArgumentException("上课提醒渠道配置无效");
        }
        JSObject result = new JSObject();
        result.put("supported", Build.VERSION.SDK_INT >= 26);
        result.put("created", false);
        if (Build.VERSION.SDK_INT < 26) return result;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) throw new IllegalStateException("系统通知服务不可用");
        // Existing channels, including their user-selected sound/vibration, are never changed.
        if (manager.getNotificationChannel(id) != null) return result;
        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.setDescription(description);
        channel.setLockscreenVisibility(visibility);
        channel.enableVibration(vibration);
        if (vibration) channel.setVibrationPattern(new long[] { 0, 250, 150, 250 });
        if (soundEnabled) {
            AudioAttributes audio = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION).build();
            channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), audio);
        } else {
            // Capacitor's createChannel omits setSound for null, which retains the default ringtone.
            // Explicit null is necessary for a truly silent, vibration-only channel.
            channel.setSound(null, null);
        }
        manager.createNotificationChannel(channel);
        if (manager.getNotificationChannel(id) == null) throw new IllegalStateException("系统未保留上课提醒渠道");
        result.put("created", true);
        return result;
    }

    static JSObject state(Context context, String channelId) {
        if (context == null) throw new IllegalStateException("系统环境不可用");
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("courseChannelsSupported", Build.VERSION.SDK_INT >= 26);
        result.put("courseAlarmClockSupported", Build.VERSION.SDK_INT >= 21);
        // Unknown is distinct from denied/off. A missing service or restricted OEM read must not
        // falsely tell the user that a permission or the speaker is enabled.
        for (String key : new String[] { "notificationsEnabled", "exactAlarmAllowed", "batteryOptimizationIgnored",
                "hasVibrator", "notificationVolume", "notificationMaxVolume", "channelExists", "channelImportance",
                "channelSoundEnabled", "channelVibrationEnabled" }) result.put(key, JSONObject.NULL);
        result.put("ringerMode", "unknown");
        result.put("interruptionFilter", "unknown");
        try { result.put("notificationsEnabled", NotificationManagerCompat.from(context).areNotificationsEnabled()); }
        catch (RuntimeException ignored) {}
        try {
            if (Build.VERSION.SDK_INT < 31) result.put("exactAlarmAllowed", true);
            else {
                AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
                if (alarms != null) result.put("exactAlarmAllowed", alarms.canScheduleExactAlarms());
            }
        } catch (RuntimeException ignored) {}
        try {
            if (Build.VERSION.SDK_INT < 23) result.put("batteryOptimizationIgnored", true);
            else {
                PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
                if (power != null) result.put("batteryOptimizationIgnored", power.isIgnoringBatteryOptimizations(context.getPackageName()));
            }
        } catch (RuntimeException ignored) {}
        try {
            Vibrator vibrator;
            if (Build.VERSION.SDK_INT >= 31) {
                VibratorManager manager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = manager == null ? null : manager.getDefaultVibrator();
            } else vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null) result.put("hasVibrator", vibrator.hasVibrator());
        } catch (RuntimeException ignored) {}
        try {
            AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (audio != null) {
                int mode = audio.getRingerMode();
                result.put("ringerMode", mode == AudioManager.RINGER_MODE_NORMAL ? "normal"
                    : mode == AudioManager.RINGER_MODE_VIBRATE ? "vibrate" : mode == AudioManager.RINGER_MODE_SILENT ? "silent" : "unknown");
                result.put("notificationVolume", audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION));
                result.put("notificationMaxVolume", audio.getStreamMaxVolume(AudioManager.STREAM_NOTIFICATION));
            }
        } catch (RuntimeException ignored) {}
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                if (Build.VERSION.SDK_INT >= 23) {
                    int filter = manager.getCurrentInterruptionFilter();
                    result.put("interruptionFilter", filter == NotificationManager.INTERRUPTION_FILTER_ALL ? "all"
                        : filter == NotificationManager.INTERRUPTION_FILTER_PRIORITY ? "priority"
                        : filter == NotificationManager.INTERRUPTION_FILTER_NONE ? "none"
                        : filter == NotificationManager.INTERRUPTION_FILTER_ALARMS ? "alarms" : "unknown");
                }
                if (Build.VERSION.SDK_INT >= 26 && channelId != null && !channelId.isEmpty() && channelId.length() <= 160) {
                    NotificationChannel channel = manager.getNotificationChannel(channelId);
                    result.put("channelExists", channel != null);
                    if (channel != null) {
                        result.put("channelImportance", channel.getImportance());
                        result.put("channelSoundEnabled", channel.getSound() != null);
                        result.put("channelVibrationEnabled", channel.shouldVibrate());
                    }
                }
            }
        } catch (RuntimeException ignored) {}
        return result;
    }
}
