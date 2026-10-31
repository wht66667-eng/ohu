package com.sunshinecampus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Cleans up focus-owned DND without a live Activity, WebView, or keep-alive service. */
public class FocusSessionEndReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (FocusNotificationScheduler.ACTION.equals(intent.getAction())) {
            String id = intent.getStringExtra("sessionId");
            if (id != null) FocusNotificationScheduler.deliver(context, intent.getIntExtra("notificationId", 0), id, intent.getLongExtra("at", 0));
        } else if ("com.sunshinecampus.FOCUS_END".equals(intent.getAction())) {
            String id = intent.getStringExtra("sessionId");
            if (id != null) FocusSessionGuard.expire(context, id, intent.getLongExtra("endsAt", 0));
        } else {
            FocusSessionGuard.reconcile(context);
            FocusNotificationScheduler.restore(context);
        }
    }
}
