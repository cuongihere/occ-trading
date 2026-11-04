package com.occtrading.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONObject;
import org.json.JSONException;

import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.Iterator;
import java.util.Set;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class MainActivity extends Activity {
    private static final String API = "https://fapi.binance.com";
    private static final String VAULT = "occ_mobile_secrets_v1";
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final SecureRandom random = new SecureRandom();
    private WebView browser;
    private volatile boolean destroyed = false;
    private volatile String apiKey = null, apiSecret = null;
    private volatile long serverOffset = 0L, lastTimeSync = 0L;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        browser = new WebView(this);
        browser.setBackgroundColor(0xff0b1422);
        WebSettings cfg = browser.getSettings();
        cfg.setJavaScriptEnabled(true);
        cfg.setDomStorageEnabled(false);
        cfg.setAllowFileAccess(true);
        cfg.setAllowContentAccess(false);
        cfg.setAllowFileAccessFromFileURLs(false);
        cfg.setAllowUniversalAccessFromFileURLs(false);
        cfg.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !("file:///android_asset/index.html".equals(request.getUrl().toString()));
            }
        });
        browser.addJavascriptInterface(new NativeBridge(), "OCCAndroid");
        setContentView(browser);
        browser.loadUrl("file:///android_asset/index.html");
    }

    private void respond(String requestId, boolean ok, String body, int status) {
        if (destroyed) return;
        String js = "window.occNativeResponse(" + JSONObject.quote(requestId) + "," + ok + "," +
            JSONObject.quote(body) + "," + status + ");";
        main.post(() -> { if (!destroyed && browser != null) browser.evaluateJavascript(js, null); });
    }

    private static String readLimited(InputStream input) throws Exception {
        try(InputStream stream=input; ByteArrayOutputStream out=new ByteArrayOutputStream()) {
            byte[] block=new byte[8192]; int n,total=0;
            while((n=stream.read(block))!=-1) {
                total+=n;
                if(total>4_000_000) throw new IllegalStateException("Response too large");
                out.write(block,0,n);
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
    private static String encode(String s) throws Exception {
        return URLEncoder.encode(s,StandardCharsets.UTF_8.name());
    }
    private static String params(JSONObject json) throws Exception {
        StringBuilder out=new StringBuilder();
        for(Iterator<String> it=json.keys();it.hasNext();) {
            String k=it.next();
            if(!k.matches("[A-Za-z][A-Za-z0-9]{0,40}")) throw new IllegalArgumentException("Invalid param");
            Object v=json.get(k);
            if(v==JSONObject.NULL || v instanceof JSONObject || v instanceof org.json.JSONArray) throw new IllegalArgumentException("Invalid param value");
            if(out.length()>0) out.append('&');
            out.append(encode(k)).append('=').append(encode(String.valueOf(v)));
        }
        return out.toString();
    }
    private static String requestNetwork(String method,String path,String parameters,String key) throws Exception {
        if(!path.startsWith("/fapi/v") || path.contains("..") || path.contains("://")) throw new SecurityException("Invalid path");
        String url=API+path+(method.equals("GET")&&parameters.length()>0?"?"+parameters:"");
        HttpURLConnection conn=(HttpURLConnection)new URL(url).openConnection();
        try {
            conn.setConnectTimeout(7000);conn.setReadTimeout(10000);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod(method);
            conn.setRequestProperty("Accept","application/json");
            if(key!=null)conn.setRequestProperty("X-MBX-APIKEY",key);
            if(!method.equals("GET")){
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type","application/x-www-form-urlencoded");
                byte[] bytes=parameters.getBytes(StandardCharsets.UTF_8);
                conn.getOutputStream().write(bytes);
                conn.getOutputStream().close();
            }
            int status=conn.getResponseCode();
            String data=readLimited(status>=400?conn.getErrorStream():conn.getInputStream());
            if(status!=200)throw new BinanceError("Binance HTTP "+status+": "+data.substring(0,Math.min(data.length(),280)),status);
            return data;
        } finally {conn.disconnect();}
    }
    private static class BinanceError extends Exception {
        final int status;
        BinanceError(String message,int status){super(message);this.status=status;}
    }
    private static String hmac(String secret,String message) throws Exception {
        Mac mac=Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
        StringBuilder output=new StringBuilder();
        for(byte b:mac.doFinal(message.getBytes(StandardCharsets.UTF_8)))
            output.append(String.format("%02x",b&0xff));
        return output.toString();
    }
    private synchronized void clockSync() throws Exception {
        if(System.currentTimeMillis()-lastTimeSync<60000)return;
        long before=System.currentTimeMillis();
        JSONObject data=new JSONObject(requestNetwork("GET","/fapi/v1/time","",null));
        long after=System.currentTimeMillis();
        serverOffset=data.getLong("serverTime")-((before+after)/2);
        if(Math.abs(serverOffset)>30000)throw new SecurityException("Clock skew >30s");
        lastTimeSync=after;
    }
    private String signedRequest(String method,String path,JSONObject args) throws Exception {
        if(apiKey==null || apiSecret==null)throw new SecurityException("API chưa kết nối");
        if(!allowSigned(method,path))throw new SecurityException("Endpoint không được phép");
        clockSync();
        JSONObject p=new JSONObject(args.toString());
        p.put("timestamp",System.currentTimeMillis()+serverOffset);
        p.put("recvWindow",5000);
        String payload=params(p);
        return requestNetwork(method,path,payload+"&signature="+hmac(apiSecret,payload),apiKey);
    }
    private static final Set<String> SIGNED_GET=new HashSet<>(Arrays.asList(
        "/fapi/v2/account","/fapi/v1/positionSide/dual","/fapi/v1/symbolConfig",
        "/fapi/v3/positionRisk","/fapi/v1/openOrders","/fapi/v1/openAlgoOrders",
        "/fapi/v1/order","/fapi/v1/algoOrder","/fapi/v1/allOrders",
        "/fapi/v1/allAlgoOrders","/fapi/v1/userTrades","/fapi/v1/income"));
    private static boolean allowSigned(String method,String path) {
        return method.equals("GET") && SIGNED_GET.contains(path) ||
            method.equals("POST") && (path.equals("/fapi/v1/order") || path.equals("/fapi/v1/algoOrder") || path.equals("/fapi/v1/leverage")) ||
            method.equals("DELETE") && path.equals("/fapi/v1/algoOrder");
    }
    private static boolean publicAllowed(String path) {
        return path.equals("/fapi/v1/time") || path.equals("/fapi/v1/exchangeInfo") ||
           path.equals("/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=500") ||
           path.equals("/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=1000");
    }

    private SecretKey vaultKey() throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        SecretKey key=(SecretKey)ks.getKey(VAULT,null);
        if(key!=null)return key;
        KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(VAULT,
            KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return gen.generateKey();
    }
    private void persistCredentials(String key,String secret) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE,vaultKey());
        JSONObject credentials=new JSONObject().put("key",key).put("secret",secret);
        String encoded=Base64.getEncoder().encodeToString(cipher.doFinal(
            credentials.toString().getBytes(StandardCharsets.UTF_8)));
        String iv=Base64.getEncoder().encodeToString(cipher.getIV());
        if(!getPreferences(MODE_PRIVATE).edit().putString("secret",encoded).putString("iv",iv).commit())
            throw new IllegalStateException("Không lưu được API");
    }
    private boolean loadCredentials() throws Exception {
        SharedPreferences p=getPreferences(MODE_PRIVATE);
        String ciphertext=p.getString("secret",null),iv=p.getString("iv",null);
        if(ciphertext==null||iv==null)return false;
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,vaultKey(),new GCMParameterSpec(128,Base64.getDecoder().decode(iv)));
        JSONObject credentials=new JSONObject(new String(cipher.doFinal(
            Base64.getDecoder().decode(ciphertext)),StandardCharsets.UTF_8));
        apiKey=credentials.getString("key");apiSecret=credentials.getString("secret");
        lastTimeSync=0L;
        return true;
    }
    private void deleteCredentials() {
        apiKey=null;apiSecret=null;
        getPreferences(MODE_PRIVATE).edit().remove("secret").remove("iv").commit();
    }
    public final class NativeBridge {
        @JavascriptInterface public String loadState() {
            return getPreferences(MODE_PRIVATE).getString("checkpoint","{}");
        }
        @JavascriptInterface public boolean saveState(String json) {
            if(json==null||json.length()>220000)return false;
            try {
                JSONObject test=new JSONObject(json);
                if(!test.has("phase") || !test.has("config"))return false;
                return getPreferences(MODE_PRIVATE).edit().putString("checkpoint",json).commit();
            }catch(Exception e){return false;}
        }
        @JavascriptInterface public String newPrefix() {
            byte[] b=new byte[7];random.nextBytes(b);StringBuilder s=new StringBuilder("OCCBTC-");
            for(byte v:b)s.append(String.format("%02x",v&255));
            return s.toString();
        }
        @JavascriptInterface public void publicGet(String path,String requestId) {
            if(!validId(requestId))return;
            if(path==null||!publicAllowed(path)){respond(requestId,false,"Public REST not allowed",403);return;}
            network.execute(()->{
                try {respond(requestId,true,requestNetwork("GET",path,"",null),200);}
                catch(Exception e){respond(requestId,false,e.getMessage(),e instanceof BinanceError?((BinanceError)e).status:0);}
            });
        }
        @JavascriptInterface public void auth(String operation,String key,String secret,boolean remember,String id) {
            if(!validId(id))return;
            network.execute(()->{
                try{
                    if("connect".equals(operation)){
                        if(key==null||secret==null||key.length()<8||secret.length()<8)throw new SecurityException("API Key/Secret không hợp lệ");
                        apiKey=key;apiSecret=secret;lastTimeSync=0;
                        clockSync();signedRequest("GET","/fapi/v2/account",new JSONObject());
                        if(remember)persistCredentials(key,secret);
                        else getPreferences(MODE_PRIVATE).edit().remove("secret").remove("iv").commit();
                    } else if("restore".equals(operation)){
                        if(!loadCredentials())throw new IllegalStateException("Không có API đã lưu");
                        clockSync();signedRequest("GET","/fapi/v2/account",new JSONObject());
                    } else if("disconnect".equals(operation)){apiKey=null;apiSecret=null;}
                    else if("forget".equals(operation)){deleteCredentials();}
                    else throw new SecurityException("Unsupported auth");
                    respond(id,true,"{\"connected\":"+(apiKey!=null)+",\"saved\":"+getPreferences(MODE_PRIVATE).contains("secret")+"}",200);
                }catch(Exception e){apiKey=null;apiSecret=null;respond(id,false,e.getMessage(),e instanceof BinanceError?((BinanceError)e).status:0);}
            });
        }
        @JavascriptInterface public void signed(String method,String path,String paramsJson,String id) {
            if(!validId(id))return;
            network.execute(()->{
                try{respond(id,true,signedRequest(method,path,new JSONObject(paramsJson)),200);}
                catch(Exception e){respond(id,false,e.getMessage(),e instanceof BinanceError?((BinanceError)e).status:0);}
            });
        }
        @JavascriptInterface public void shareCsv(String csv) {
            if(csv==null||csv.length()>500000)return;
            main.post(()->{
                Intent send=new Intent(Intent.ACTION_SEND);
                send.setType("text/csv");
                send.putExtra(Intent.EXTRA_TEXT,csv);
                startActivity(Intent.createChooser(send,"Xuất lịch sử OCC"));
            });
        }
    }
    private static boolean validId(String id){return id!=null&&id.matches("[0-9]{1,12}");}
    @Override protected void onDestroy(){
        destroyed=true;network.shutdownNow();
        apiKey=null;apiSecret=null;
        if(browser!=null){browser.loadUrl("about:blank");browser.destroy();browser=null;}
        super.onDestroy();
    }
}
