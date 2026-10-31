package com.sunshinecampus.app;

import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.content.ContextCompat;

/** A single non-focusable card, no service, sound, wake-lock or lock-screen flags. */
final class ReminderOverlayWindow {
    static final String OPEN_ROUTE = "reminderOverlayRoute";
    static final String OPEN_OWNER = "reminderOverlayOwner";
    static final String OPEN_PREVIEW = "reminderOverlayPreview";
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static View currentView;
    private static WindowManager currentManager;
    private static Context currentContext;
    private static BroadcastReceiver screenOffReceiver;
    private static Runnable expiration;
    private static Runnable guard;

    static String show(Context context, String title, String body, String route, String owner, boolean preview) {
        if (Looper.myLooper() != Looper.getMainLooper()) return "桌面提醒展示线程不可用";
        if (!ReminderOverlayStore.enabled(context)) return "桌面覆盖提醒尚未开启";
        if (!ReminderOverlayStore.granted(context)) return "显示在其他应用上层权限尚未允许";
        if (owner == null || owner.isEmpty() || !owner.equals(ReminderOverlayStore.owner(context))) return "提醒所属账号已变化";
        if (!screenAvailable(context)) return "锁屏或熄屏时使用系统通知，不显示桌面覆盖";
        dismissNow();
        WindowManager manager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        if (manager == null) return "桌面窗口服务不可用";
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL); card.setPadding(dp(context, 16), dp(context, 12), dp(context, 16), dp(context, 8));
        GradientDrawable background = new GradientDrawable(); background.setColor(Color.rgb(255, 253, 249)); background.setCornerRadius(dp(context, 18)); background.setStroke(dp(context, 1), Color.rgb(218, 215, 209));
        card.setBackground(background); card.setElevation(dp(context, 8));
        TextView brand = text(context, preview ? "哦狐 · 桌面提醒预览" : "哦狐 · 课程提醒", 12, Color.rgb(112, 102, 94));
        card.addView(brand);
        TextView heading = text(context, title, 17, Color.rgb(40, 42, 45)); heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD); heading.setMaxLines(2); heading.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams headingLayout = new LinearLayout.LayoutParams(-1, -2); headingLayout.topMargin = dp(context, 8); card.addView(heading, headingLayout);
        TextView summary = text(context, body, 14, Color.rgb(81, 85, 91)); summary.setMaxLines(3); summary.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams summaryLayout = new LinearLayout.LayoutParams(-1, -2); summaryLayout.topMargin = dp(context, 6); card.addView(summary, summaryLayout);
        LinearLayout actions = new LinearLayout(context); actions.setOrientation(LinearLayout.HORIZONTAL); actions.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        Button close = action(context, "关闭"); close.setContentDescription("关闭桌面提醒"); close.setOnClickListener(view -> dismiss());
        Button open = action(context, "/schedule".equals(ReminderOverlayStore.route(route).split("[?#]", 2)[0]) ? "查看课表" : "查看详情");
        open.setOnClickListener(view -> {
            if (!ReminderOverlayStore.enabled(context) || !owner.equals(ReminderOverlayStore.owner(context)) || !screenAvailable(context)) { dismiss(); return; }
            Intent launch = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launch.putExtra(OPEN_ROUTE, ReminderOverlayStore.route(route)); launch.putExtra(OPEN_OWNER, owner); launch.putExtra(OPEN_PREVIEW, preview);
            try { context.startActivity(launch); } catch (RuntimeException failure) { ReminderOverlayStore.error(context, "打开提醒详情失败，请从 App 查看课表"); }
            dismiss();
        });
        actions.addView(close); actions.addView(open);
        LinearLayout.LayoutParams actionsLayout = new LinearLayout.LayoutParams(-1, -2); actionsLayout.topMargin = dp(context, 6); card.addView(actions, actionsLayout);
        int screenWidth = context.getResources().getDisplayMetrics().widthPixels;
        int width = Math.max(dp(context, 220), Math.min(dp(context, 360), screenWidth - dp(context, 32)));
        WindowManager.LayoutParams layout = new WindowManager.LayoutParams(width, WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL, PixelFormat.TRANSLUCENT);
        layout.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL; layout.y = dp(context, 64); layout.setTitle("OhFox reminder card");
        try {
            manager.addView(card, layout);
            currentView = card; currentManager = manager; currentContext = context.getApplicationContext();
            screenOffReceiver = new BroadcastReceiver() { @Override public void onReceive(Context ignored, Intent intent) { dismiss(); } };
            ContextCompat.registerReceiver(currentContext, screenOffReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED);
            expiration = () -> dismissNow(); MAIN.postDelayed(expiration, 12000);
            guard = new Runnable() { @Override public void run() {
                if (currentView != card) return;
                if (!screenAvailable(context) || !ReminderOverlayStore.enabled(context) || !ReminderOverlayStore.granted(context) || !owner.equals(ReminderOverlayStore.owner(context))) { dismissNow(); return; }
                MAIN.postDelayed(this, 750);
            }}; MAIN.postDelayed(guard, 750);
            return null;
        } catch (RuntimeException failure) {
            try { manager.removeViewImmediate(card); } catch (RuntimeException ignored) { }
            dismissNow(); ReminderOverlayStore.error(context, "系统未允许展示桌面覆盖提醒"); return "系统未允许展示桌面覆盖提醒";
        }
    }
    static void dismiss() { if (Looper.myLooper() == Looper.getMainLooper()) dismissNow(); else MAIN.post(ReminderOverlayWindow::dismissNow); }
    private static void dismissNow() {
        if (expiration != null) MAIN.removeCallbacks(expiration);
        if (guard != null) MAIN.removeCallbacks(guard);
        expiration = null; guard = null;
        if (currentView != null && currentManager != null) try { currentManager.removeViewImmediate(currentView); } catch (RuntimeException ignored) { }
        if (screenOffReceiver != null && currentContext != null) try { currentContext.unregisterReceiver(screenOffReceiver); } catch (RuntimeException ignored) { }
        currentView = null; currentManager = null; currentContext = null; screenOffReceiver = null;
    }
    private static boolean screenAvailable(Context context) {
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        KeyguardManager keyguard = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        return power != null && power.isInteractive() && keyguard != null && !keyguard.isKeyguardLocked();
    }
    private static TextView text(Context context, String value, int size, int color) {
        TextView text = new TextView(context); text.setText(value); text.setTextSize(size); text.setTextColor(color); text.setLineSpacing(dp(context, 2), 1); return text;
    }
    private static Button action(Context context, String label) {
        Button button = new Button(context); button.setText(label); button.setTextSize(14); button.setAllCaps(false); button.setTextColor(Color.rgb(156, 71, 35));
        button.setMinHeight(dp(context, 44)); button.setMinimumHeight(dp(context, 44)); button.setPadding(dp(context, 10), 0, dp(context, 10), 0); button.setBackgroundColor(Color.TRANSPARENT); return button;
    }
    private static int dp(Context context, int value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }
}
