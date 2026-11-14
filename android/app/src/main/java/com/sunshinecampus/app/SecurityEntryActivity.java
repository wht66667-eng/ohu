package com.sunshinecampus.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** 所有桌面图标、通知和组件先经过此入口，确认安全后才创建业务 WebView。 */
public final class SecurityEntryActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (DeviceIntegrityGate.hasConfirmedRoot()) {
            startActivity(new Intent(this, SecurityBlockedActivity.class));
        } else {
            Intent target = new Intent(this, MainActivity.class);
            if (getIntent() != null) {
                // 桌面别名是公开入口，只转发 App 自己使用的固定路由参数。
                String widgetRoute = WidgetLinks.safeRoute(getIntent().getStringExtra(WidgetLinks.ROUTE_EXTRA));
                if (widgetRoute != null) target.putExtra(WidgetLinks.ROUTE_EXTRA, widgetRoute);
                String focus = getIntent().getStringExtra("focusNotificationRoute");
                if ("/study".equals(focus) || "/study/focus".equals(focus)) {
                    target.putExtra("focusNotificationRoute", focus);
                }
                if (getIntent().hasExtra(ReminderOverlayWindow.OPEN_ROUTE)) {
                    String owner = getIntent().getStringExtra(ReminderOverlayWindow.OPEN_OWNER);
                    if (owner != null && !owner.isEmpty()) {
                        target.putExtra(ReminderOverlayWindow.OPEN_ROUTE,
                            ReminderOverlayStore.route(getIntent().getStringExtra(ReminderOverlayWindow.OPEN_ROUTE)));
                        target.putExtra(ReminderOverlayWindow.OPEN_OWNER, owner);
                        target.putExtra(ReminderOverlayWindow.OPEN_PREVIEW,
                            getIntent().getBooleanExtra(ReminderOverlayWindow.OPEN_PREVIEW, false));
                    }
                }
                if (BuildConfig.DEBUG && getIntent().hasExtra("testReminderSeconds")) {
                    int seconds = getIntent().getIntExtra("testReminderSeconds", 60);
                    if (seconds >= 1 && seconds <= 600) target.putExtra("testReminderSeconds", seconds);
                }
            }
            target.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(target);
        }
        finish();
    }
}
