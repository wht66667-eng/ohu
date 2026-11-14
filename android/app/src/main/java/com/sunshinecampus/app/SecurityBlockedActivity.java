package com.sunshinecampus.app;

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.TextView;

/** 不创建 WebView、不读取账号信息的原生阻断页。 */
public final class SecurityBlockedActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(pad, pad, pad, pad);
        panel.setBackgroundColor(0xffffffff);
        TextView title = new TextView(this);
        title.setText("设备安全检查未通过");
        title.setTextColor(0xff153b2c);
        title.setTextSize(23);
        title.setGravity(Gravity.CENTER);
        panel.addView(title);
        TextView detail = new TextView(this);
        detail.setText("检测到设备已取得 Root 权限或运行环境异常。为保护校园账号与个人信息，哦狐暂时不能在此设备上使用。请在安全设备上打开应用。");
        detail.setTextColor(0xff4d6259);
        detail.setTextSize(15);
        detail.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(-1, -2);
        detailParams.topMargin = pad;
        panel.addView(detail, detailParams);
        setContentView(panel);
    }

    @Override
    public void onBackPressed() {
        finishAffinity();
    }
}
