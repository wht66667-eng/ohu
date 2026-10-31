package com.sunshinecampus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/**
 * 开机 / 覆盖安装后把常驻提醒挂回去。
 *
 * 系统闹钟本身由本地通知插件的 LocalNotificationRestoreReceiver 负责恢复，
 * 不依赖本接收器；这里补的是「常驻通知」与「应用内到点弹层」需要的那个前台服务 ——
 * 否则重启一次，进程不再被留在后台，弹层与语音就失效了。
 *
 * 是否恢复以原生 SharedPreferences 里的用户偏好为准（由 KeepAlivePlugin 写入）：
 * 用户没开过、或在设置里主动关过，这里就不动。
 */
public class KeepAliveBootReceiver extends BroadcastReceiver {

    static final String PREFS = "sc_keepalive";
    static final String KEY_WANTED = "wanted";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (AdminShellReminderCleanup.enforce(context)) return;
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }
        if (!context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_WANTED, false)) return;
        // 没有通知权限时前台服务起了也看不见通知，等用户下次打开 App 再补。
        if (!KeepAliveService.canPostNotifications(context)) return;
        try {
            ContextCompat.startForegroundService(context, new Intent(context, KeepAliveService.class).putExtra(KeepAliveService.EXTRA_RESTORE_ONLY_IF_WANTED, true));
        } catch (Throwable ignored) {
            /* 开机阶段系统可能拒绝拉起前台服务，打开 App 时会由 restoreKeepAliveIfWanted 补上 */
        }
    }
}
