package vip.touhou.webviewlab;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final String DEFAULT_URL = "http://touhou.vip/eagler-touhou/";

    private WebView webView;
    private EditText address;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WebView.setWebContentsDebuggingEnabled(true);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        TextView provider = new TextView(this);
        PackageInfo current = WebView.getCurrentWebViewPackage();
        provider.setText(current == null
                ? "WebView provider: unavailable"
                : "WebView: " + current.packageName + " " + current.versionName);
        provider.setTextColor(Color.DKGRAY);
        provider.setPadding(12, 8, 12, 4);
        root.addView(provider, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        address = new EditText(this);
        address.setSingleLine(true);
        toolbar.addView(address, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        Button go = new Button(this);
        go.setText("Go");
        go.setOnClickListener(v -> loadAddress());
        toolbar.addView(go);

        Button reload = new Button(this);
        reload.setText("Reload");
        reload.setOnClickListener(v -> webView.reload());
        toolbar.addView(reload);
        root.addView(toolbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                address.setText(url);
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);

        String initialUrl = resolveInitialUrl(getIntent());
        address.setText(initialUrl);
        webView.loadUrl(initialUrl);
    }

    private static String resolveInitialUrl(Intent intent) {
        Uri data = intent.getData();
        if (data != null) {
            return data.toString();
        }
        String extra = intent.getStringExtra("url");
        return extra == null || extra.trim().isEmpty() ? DEFAULT_URL : extra.trim();
    }

    private void loadAddress() {
        String url = address.getText().toString().trim();
        if (!url.contains("://")) {
            url = "http://" + url;
        }
        webView.loadUrl(url);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
