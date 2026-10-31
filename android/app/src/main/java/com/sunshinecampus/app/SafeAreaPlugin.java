package com.sunshinecampus.app;

import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Overlay WebView owns NO native margins: CSS receives all system-bar/cutout insets once. */
@CapacitorPlugin(name = "SafeArea")
public class SafeAreaPlugin extends Plugin {
    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            WindowCompat.setDecorFitsSystemWindows(getActivity().getWindow(), false);
            View view = getBridge().getWebView();
            ViewCompat.setOnApplyWindowInsetsListener(view, (v, insets) -> {
                notifyListeners("insetsChanged", values(insets));
                return insets;
            });
            ViewCompat.requestApplyInsets(view);
        });
    }

    @PluginMethod
    public void getInsets(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(getBridge().getWebView());
            call.resolve(values(insets));
        });
    }

    private JSObject values(WindowInsetsCompat insets) {
        Insets bars = insets == null ? Insets.NONE : insets.getInsets(
            WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        float density = getContext().getResources().getDisplayMetrics().density;
        boolean keyboard = insets != null && insets.isVisible(WindowInsetsCompat.Type.ime());
        JSObject result = new JSObject();
        result.put("top", bars.top / density);
        result.put("bottom", keyboard ? 0 : bars.bottom / density);
        result.put("left", bars.left / density);
        result.put("right", bars.right / density);
        result.put("keyboardHeight", keyboard ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom / density : 0);
        return result;
    }
}
