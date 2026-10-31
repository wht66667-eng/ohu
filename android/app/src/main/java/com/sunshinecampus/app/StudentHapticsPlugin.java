package com.sunshinecampus.app;

import android.view.HapticFeedbackConstants;
import android.view.View;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Uses the system's touch-feedback setting; never forces vibration. */
@CapacitorPlugin(name = "StudentHaptics")
public final class StudentHapticsPlugin extends Plugin {
    @PluginMethod public void tap(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            View view = getBridge().getWebView();
            boolean performed = view != null && view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
            JSObject result = new JSObject();
            result.put("performed", performed);
            call.resolve(result);
        });
    }
}
