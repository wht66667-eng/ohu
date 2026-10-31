import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { files as planFiles } from './review/reminder-plan-fixtures.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
function jar(dir){if(!fs.existsSync(dir))return null;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){const found=jar(p);if(found)return found}else if(/^json-.*\.jar$/.test(e.name))return p}return null}
test('actual overlay store keeps phase expiry through sync/restore and refuses late cards with bounded legacy fallback',()=>{
  const json=jar(path.join(os.homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json'));assert.ok(json)
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ohu-overlay-expiry-'))
  const files={...planFiles};delete files['com/sunshinecampus/app/ReminderPlanHarness.java'];delete files['com/sunshinecampus/app/ReminderOverlayStore.java']
  files['android/content/SharedPreferences.java']=files['android/content/SharedPreferences.java'].replace('boolean commit();','boolean commit();default void apply(){commit();}')
  files['android/content/Intent.java']=files['android/content/Intent.java'].replace('public String getAction()','public Intent putExtra(String k,int v){return this;}public Intent putExtra(String k,long v){return this;}public Intent putExtra(String k,String v){return this;}public String getAction()')
  files['android/net/Uri.java']='package android.net;public class Uri{public String value;public static Uri parse(String s){Uri u=new Uri();u.value=s;return u;}public static class Builder{String value="";public Builder scheme(String s){value=s+":";return this;}public Builder authority(String s){value+="//"+s;return this;}public Builder appendPath(String s){value+="/"+s;return this;}public Uri build(){return parse(value);}}}'
  files['android/provider/Settings.java']='package android.provider;public class Settings{public static boolean canDrawOverlays(android.content.Context c){return true;}}'
  files['com/sunshinecampus/app/ReminderOverlayWindow.java']='package com.sunshinecampus.app;class ReminderOverlayWindow{static void dismiss(){}}'
  files['com/sunshinecampus/app/ReminderOverlayReceiver.java']='package com.sunshinecampus.app;class ReminderOverlayReceiver{}'
  files['com/sunshinecampus/app/ReminderOverlayStore.java']=fs.readFileSync(path.join(root,'android/app/src/main/java/com/sunshinecampus/app/ReminderOverlayStore.java'),'utf8').replace('JSONException | RuntimeException','Exception')
  files['com/sunshinecampus/app/OverlayExpiryHarness.java']=`package com.sunshinecampus.app;import android.content.*;import org.json.*;public class OverlayExpiryHarness{
    static void check(boolean v,String m){if(!v)throw new AssertionError(m);}
    static JSONObject item(long at,Long expiry){JSONObject x=new JSONObject().put("id",43000).put("at",at).put("ownerUid","A").put("title","课程").put("body","地点").put("route","/schedule");if(expiry!=null)x.put("expiresAt",expiry);return x;}
    static void seed(Context c,JSONObject x){c.getSharedPreferences("reminder.overlay.v1",0).edit().putString("ownerUid","A").putBoolean("enabled",true).putString("plans",new JSONArray().put(x).toString()).commit();}
    public static void main(String[]args)throws Exception{long now=System.currentTimeMillis();Context c=new Context();long at=now+60000,expiry=at+45000;ReminderOverlayStore.sync(c,"A",new JSONArray().put(item(at,expiry)));JSONArray stored=new JSONArray(c.getSharedPreferences("reminder.overlay.v1",0).getString("plans","[]"));check(stored.getJSONObject(0).getLong("expiresAt")==expiry,"sync dropped phase expiry");ReminderOverlayStore.restore(c);check(new JSONArray(c.getSharedPreferences("reminder.overlay.v1",0).getString("plans","[]")).getJSONObject(0).getLong("expiresAt")==expiry,"restore reset expiry");
    seed(c,item(now-30000,now+15000));check(ReminderOverlayStore.consume(c,43000,"A",now-30000)!=null,"fresh phase-bounded card lost before expiry");
    seed(c,item(now-60000,now+1800000));check(ReminderOverlayStore.consume(c,43000,"A",now-60000)==null,"saved thirty-minute course card bypassed new one-minute cutoff");
    seed(c,item(now-300000,now-1));check(ReminderOverlayStore.consume(c,43000,"A",now-300000)==null,"expired phase displayed");
    seed(c,item(now-300000,null));check(ReminderOverlayStore.consume(c,43000,"A",now-300000)==null,"legacy card obtained unbounded lifetime");
    seed(c,item(now-30000,null));check(ReminderOverlayStore.consume(c,43000,"A",now-30000)!=null,"fresh legacy card blocked");
    seed(c,item(now-300000,now-300000));check(ReminderOverlayStore.consume(c,43000,"A",now-300000)==null,"invalid phase bound accepted");
    seed(c,item(at,expiry));String before=c.getSharedPreferences("reminder.overlay.v1",0).getString("plans","");boolean failed=false;try{ReminderOverlayStore.sync(c,"A",new JSONArray().put(item(at,at)));}catch(IllegalArgumentException expected){failed=true;}check(failed&&before.equals(c.getSharedPreferences("reminder.overlay.v1",0).getString("plans","")),"invalid input destroyed prior plan");System.out.println("PASS overlay phase expiry, restore, exact stale suppression and legacy bound");}}
  `
  try{const paths=[];for(const [name,source]of Object.entries(files)){const file=path.join(scratch,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);paths.push(file)}execFileSync('javac',['-encoding','UTF-8','-classpath',json,'-d',scratch,...paths],{stdio:'pipe'});const out=execFileSync('java',['-cp',`${scratch}${path.delimiter}${json}`,'com.sunshinecampus.app.OverlayExpiryHarness'],{encoding:'utf8'});assert.match(out,/PASS overlay phase expiry/)}catch(e){if(e.stderr)process.stderr.write(e.stderr);throw e}finally{assert.ok(path.resolve(scratch).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(scratch).startsWith('ohu-overlay-expiry-'));fs.rmSync(scratch,{recursive:true,force:true})}
})
