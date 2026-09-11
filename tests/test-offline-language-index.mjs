import assert from "node:assert/strict";
import { buildLanguageCatalog } from "../.cache/build/browser/assets/launcher/language-catalog.mjs";
import { loadOfflineLanguageIndex, rememberOfflineLanguage } from "../.cache/build/browser/assets/launcher/offline-language-index.mjs";
class S { constructor(){this.m=new Map()} getItem(k){return this.m.get(k)??null} setItem(k,v){this.m.set(k,String(v))} }
const storage=new S();
const pack={language:"lang_en",url:"https://example.invalid/en.zip",sha256:"a".repeat(64),bytes:12};
assert.equal(rememberOfflineLanguage(storage,"th06",{id:"lang_en",title:"English",pack:null},pack),true);
const offline=loadOfflineLanguageIndex(storage,"th06");
const catalog=buildLanguageCatalog({languageOptions:[{id:"ja",title:"Japanese",pack:null}],offlineEntries:offline,priority:()=>0});
assert.ok(catalog.some(x=>x.id==="lang_en"));
console.log("Offline language index: PASS");
