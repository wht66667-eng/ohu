package com.sunshinecampus.app;

import android.content.pm.ApplicationInfo;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import androidx.core.splashscreen.SplashScreen;

/**
 * 多壳注入：把 Gradle flavor（SC_SHELL）尽早写入 window.__SC_SHELL__，
 * 与前端 app-shell.ts / Capacitor App.getInfo().id 对齐。
 * 注册 LauncherIcon 插件用于桌面图标变脸。
 */
public class MainActivity extends BridgeActivity {
    private int scheduleWidgetRouteAttempts = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        AdminShellReminderCleanup.enforce(this);
        registerPlugin(LauncherIconPlugin.class);
        registerPlugin(FocusLockPlugin.class);
        registerPlugin(KeepAlivePlugin.class);
        registerPlugin(ReminderOverlayPlugin.class);
        registerPlugin(ReminderBootPlugin.class);
        registerPlugin(ReminderPlanPlugin.class);
        registerPlugin(SafeAreaPlugin.class);
        registerPlugin(AppProbePlugin.class);
        registerPlugin(StudentHapticsPlugin.class);
        registerPlugin(ShareGalleryPlugin.class);
        registerPlugin(HealthPlugin.class);
        if ("user".equals(BuildConfig.SC_SHELL)) registerPlugin(ScheduleWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!debuggable) {
            WebView.setWebContentsDebuggingEnabled(false);
        }
        injectShell();
        /* onCreate 也已在前台：迁移为默认关闭时避免立即禁用启动别名导致 ROM 杀进程。 */
        LauncherIconSwitcher.setAppInForeground(true);
        /* 仅显式开启的学生端安排变脸；关闭状态由调度器取消旧任务并恢复默认。 */
        try {
            if ("user".equals(BuildConfig.SC_SHELL)) {
                IconMoodScheduler.ensure(this);
                IconMoodScheduler.runNow(this);
            } else {
                LauncherIconSwitcher.apply(this, "default");
            }
        } catch (Throwable ignored) {
            /* ignore */
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        AdminShellReminderCleanup.enforce(this);
        LauncherIconSwitcher.setAppInForeground(true);
        FocusSessionGuard.reconcile(this);
        injectShell();
    }

    @Override
    public void onPause() {
        super.onPause();
        /* 退到后台才允许切换桌面图标别名（前台切换会在部分 ROM 上杀死刚启动的 Activity） */
        LauncherIconSwitcher.setAppInForeground(false);
        LauncherIconSwitcher.onAppBackground(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        injectShell();
    }

    private void injectShell() {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            String shell = BuildConfig.SC_SHELL;
            if (shell == null || shell.isEmpty()) shell = "user";
            String js = "window.__SC_SHELL__='" + shell.replace("'", "") + "';";
            boolean openScheduleWidget = "user".equals(shell) && getIntent() != null
                    && "/schedule".equals(getIntent().getStringExtra("scheduleWidgetRoute"));
            if (openScheduleWidget && getBridge().getWebView().getProgress() >= 100) {
                js += "window.__SC_WIDGET_ROUTE__='/schedule';window.dispatchEvent(new Event('native-schedule-widget-open'));";
                scheduleWidgetRouteAttempts = 0;
            } else if (openScheduleWidget && scheduleWidgetRouteAttempts < 20) {
                // The launch intent may arrive before the SPA is ready. Retry on
                // the WebView queue and consume the route only after page load.
                scheduleWidgetRouteAttempts++;
                getBridge().getWebView().postDelayed(this::injectShell, 300);
            } else if (openScheduleWidget) {
                // Do not keep retrying forever if the app page failed to load.
                getIntent().removeExtra("scheduleWidgetRoute");
                scheduleWidgetRouteAttempts = 0;
            }
            if (getIntent() != null && "/study/focus".equals(getIntent().getStringExtra("focusNotificationRoute"))) {
                js += "window.__SC_FOCUS_ROUTE__='/study/focus';window.dispatchEvent(new Event('native-focus-notification'));";
            }
            // 自检通道：adb / 内部工具可以带 --ei testReminderSeconds 60 排一条测试提醒。
            // 必须等 WebView 真正加载了页面再注入：启动瞬间注入会落在稍后被替换掉的空白文档里，
            // 参数跟着丢失。页面就绪后注入的全局变量会留在同一文档，React 挂载时能读到。
            if (getIntent() != null && getIntent().hasExtra("testReminderSeconds")) {
                String url = getBridge().getWebView().getUrl();
                boolean pageReady = url != null && !url.startsWith("about:") && !url.startsWith("data:");
                if (pageReady) {
                    int secs = getIntent().getIntExtra("testReminderSeconds", 60);
                    getIntent().removeExtra("testReminderSeconds");
                    js += "window.__SC_TEST_REMINDER__=" + secs + ";window.dispatchEvent(new Event('native-test-reminder'));";
                }
            }
            getBridge().getWebView().evaluateJavascript(js, null);
            if (openScheduleWidget && getBridge().getWebView().getProgress() >= 100) {
                getIntent().removeExtra("scheduleWidgetRoute");
            }
        } catch (Throwable ignored) {
            /* WebView 尚未就绪时忽略，onResume 会再试 */
        }
    }
}
