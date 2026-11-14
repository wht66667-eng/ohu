package com.sunshinecampus.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * 常驻提醒守护：前台服务 + 常驻通知。
 *
 * 可提高进程留在后台的机会：
 * - 系统闹钟（LocalNotifications → AlarmManager）本身不依赖本服务；
 * - 应用内到点弹层（RemindHost 的轮询）需要进程存活；厂商系统仍可能回收或冻结服务。
 *
 * 通知文案由前端通过 Intent extra 传入（例如「下次提醒 · 高等数学 08:00」），
 * 所以这是一条有真实内容、用户可见且可一键关闭的常驻通知。
 *
 * 前台服务类型用 specialUse 而不是 dataSync：本服务不做数据同步，
 * 且 Android 15 起 dataSync 类型累计 6 小时会被系统强制结束。
 */
public class KeepAliveService extends Service {
    static volatile boolean running = false;

    private static final String CHANNEL_ID = "keep-alive-v1";
    private static final int NOTIFICATION_ID = 70501;
    /**
     * 独立常驻卡：不走 startForeground，而是普通 notify()。
     * 前台服务的通知（70501）在服务/进程被杀时会被系统一并撤销 —— 这就是
     * 「划掉后台后常驻通知消失」的原因。普通通知归 NotificationManagerService 管，
     * 进程死了它仍在通知栏（只有 force-stop / 清数据才会清掉），
     * 这样划掉后台后用户仍能看到「闹钟已布防」和下一次提醒时间。
     */
    private static final int STANDALONE_NOTIFICATION_ID = 70502;
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";
    public static final String EXTRA_RESTORE_ONLY_IF_WANTED = "restoreOnlyIfWanted";
    private static final String ACTION_STOP = "com.sunshinecampus.app.KEEP_ALIVE_STOP";

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (AdminShellReminderCleanup.isManagement()) {
            AdminShellReminderCleanup.enforce(this);
            stopSelfNow(true);
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelfNow(true);
            return START_NOT_STICKY;
        }
        // A queued automatic restore must not undo a later tap on “关闭常驻”.
        if ((intent == null || intent.getBooleanExtra(EXTRA_RESTORE_ONLY_IF_WANTED, false))
            && !getSharedPreferences(KeepAliveBootReceiver.PREFS, Context.MODE_PRIVATE).getBoolean(KeepAliveBootReceiver.KEY_WANTED, false)) {
            stopSelfNow(false);
            return START_NOT_STICKY;
        }
        String title = "哦狐提醒守护中";
        String text = "上课 / 考试 / 待办提醒已安排，到点会通知你";
        if (intent != null) {
            String t = intent.getStringExtra(EXTRA_TITLE);
            String b = intent.getStringExtra(EXTRA_TEXT);
            if (t != null && !t.trim().isEmpty()) title = t;
            if (b != null && !b.trim().isEmpty()) text = b;
        }
        try {
            Notification notification = buildNotification(title, text);
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            running = true;
            // 前台卡随服务生死；再补一张独立卡，划掉后台后通知栏仍留一条「闹钟已布防」。
            postStandalone(this, text);
        } catch (Throwable error) {
            // 通知被禁用或系统拒绝前台服务时，不能崩在后台，直接退出由前端提示。
            running = false;
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    /** Android 15+ 对限时前台服务到点回调；specialUse 理论上不触发，兜底收尾。 */
    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelfNow(false);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        if (AdminShellReminderCleanup.enforce(this)) return;
        if (!getSharedPreferences(KeepAliveBootReceiver.PREFS, Context.MODE_PRIVATE).getBoolean(KeepAliveBootReceiver.KEY_WANTED, false)) return;
        // When Android delivers this callback, rebuild the saved system alarms
        // without depending on a surviving WebView or enabling a stopped guardian.
        // The planner filters expired events and preserves owner/boot preferences.
        try { ReminderPlanStore.recover(this); }
        catch (RuntimeException failure) { android.util.Log.w("OhuReminder", "Course alarm recovery after task removal failed", failure); }
    }

    @Override
    public void onDestroy() {
        running = false;
        // Service destruction is not user consent to stop reminders. Keep the
        // independent card; explicit stop paths remove it even if no service lives.
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "常驻提醒", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("显示下一次提醒时间；实际送达受系统通知与电池设置影响");
            channel.setShowBadge(false);
            channel.enableVibration(false);
            channel.setSound(null, null);
            nm.createNotificationChannel(channel);
        } catch (Throwable ignored) {
            /* 渠道已存在或系统受限 */
        }
    }

    private Notification buildNotification(String title, String text) {
        Intent open = new Intent(this, SecurityEntryActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra("focusNotificationRoute", "/study");
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, open, flags);

        Intent stop = new Intent(this, KeepAliveService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(this, 1, stop, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setAutoCancel(false)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(0, "关闭常驻", stopIntent);
        if (Build.VERSION.SDK_INT < 26) builder.setPriority(Notification.PRIORITY_LOW);
        return builder.build();
    }

    private void stopSelfNow(boolean userRequested) {
        running = false;
        if (userRequested) {
            getSharedPreferences(KeepAliveBootReceiver.PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean(KeepAliveBootReceiver.KEY_WANTED, false).apply();
            cancelStandalone(this);
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Throwable ignored) {
            /* 前台状态可能已被系统回收 */
        }
        stopSelf();
    }

    static boolean canPostNotifications(Context ctx) {
        if (Build.VERSION.SDK_INT < 33) return true;
        return ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
    }

    /* ---------------- 独立常驻卡（进程被杀后仍在通知栏） ---------------- */

    /** 发一张不依赖前台服务的 ongoing 通知；文案随服务刷新，进程被杀后原样保留。 */
    static void postStandalone(Context ctx, String text) {
        if (!canPostNotifications(ctx)) return;
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            Intent open = new Intent(ctx, SecurityEntryActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            open.putExtra("focusNotificationRoute", "/study");
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            PendingIntent contentIntent = PendingIntent.getActivity(ctx, 2, open, flags);

            Intent stop = new Intent(ctx, KeepAliveService.class).setAction(ACTION_STOP);
            PendingIntent stopIntent = PendingIntent.getService(ctx, 3, stop, flags);

            Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(ctx, CHANNEL_ID)
                : new Notification.Builder(ctx);
            builder.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("系统提醒已安排")
                .setContentText(text == null || text.trim().isEmpty()
                    ? "点按查看提醒；声音、震动与到达时间受系统设置影响"
                    : text)
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setAutoCancel(false)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_ALARM)
                .addAction(0, "关闭常驻", stopIntent);
            if (Build.VERSION.SDK_INT < 26) builder.setPriority(Notification.PRIORITY_LOW);
            nm.notify(STANDALONE_NOTIFICATION_ID, builder.build());
        } catch (Throwable ignored) {
            /* 通知被禁用或系统受限；前台卡仍然在 */
        }
    }

    /** 收走独立卡（用户主动关闭常驻时调用）。 */
    static void cancelStandalone(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(STANDALONE_NOTIFICATION_ID);
        } catch (Throwable ignored) {
            /* 通知管理器不可用时无需处理 */
        }
    }
}
