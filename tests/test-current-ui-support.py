"""HTTP-free contract checks for current native-browser input guard helpers."""
import hashlib
import ast
import io
import json
import sys
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent/'support'))
from current_ui import (current_url,require_local_publication,require_local_relay,runtime_url,
                        RUNTIME_FRAME_URL_JS,RUNTIME_FRAME_CLOSED_JS,RUNTIME_EVENT_OBSERVER_JS,wait_for_launch_action)


def fixtures():
    files=[{'path':'th06.html','bytes':4,'sha256':'a'*64}]
    payload=['eagler-touhou/runtime-generation/1','th06.html',[['th06.html',4,'a'*64]]]
    generation=hashlib.sha256(json.dumps(payload,separators=(',',':')).encode()).hexdigest()
    runtime=f'runtime/th06/{generation}/th06.html'
    return {'ui-publication.json':{'schema':'eagler-touhou/ui-publication/1','status':'react-main','mountPath':'/nested/','uiBuild':{'sha256':'b'*64}},
            'host-manifest.json':{'schema':'eagler-touhou/host-manifest/1','protocol':'eagler-touhou/1','shared':{'runtimeManifest':'runtime-manifest.json','netplayRelay':'ws://127.0.0.1:9000/'},'games':{'th06':{'runtime':runtime,'multiplayerRuntime':runtime}}},
            'runtime-manifest.json':{'schema':'eagler-touhou/runtime-manifest/1','protocol':'eagler-touhou/1','groups':[{'root':'runtime/th06/','current':{'generation':generation,'entry':'th06.html','files':files},'previous':[]}]}}


class Response(io.BytesIO):
    headers={'Content-Type':'application/json'}


class GuardTests(unittest.TestCase):
    def invoke(self,values,**options):
        class Opener:
            def open(self,request,timeout):
                self_url=request.full_url
                assert self_url.startswith('http://127.0.0.1:8000/nested/'),self_url
                return Response(json.dumps(values[self_url.rsplit('/',1)[-1]]).encode())
        with patch('current_ui.build_opener',return_value=Opener()):
            return require_local_publication('http://127.0.0.1:8000/nested/',**options)
    def test_nested_english_query(self):
        self.assertEqual(current_url('http://localhost:8/nested/','lobby',game='th06mp'),'http://localhost:8/nested/lobby?uiLocale=en&game=th06mp')
        self.assertEqual(current_url('http://localhost:8/nested/en.html','play/th06'),'http://localhost:8/nested/play/th06?uiLocale=en')
    def test_verified_shape_does_not_claim_native_authenticity(self):
        self.assertEqual(self.invoke(fixtures(),games=['th06mp']),'http://127.0.0.1:8000/nested/')
        self.assertIn('host',self.invoke(fixtures(),metadata=True))
    def test_rejects_remote_or_credentialed_target_before_read(self):
        for value in ['https://example.com/','http://user:secret@localhost/','file:///tmp/site']:
            with self.assertRaises(ValueError):require_local_publication(value)
    def test_rejects_missing_publication_and_dev_runtime_pointer(self):
        values=fixtures();values['ui-publication.json']['status']='legacy'
        with self.assertRaises(ValueError):self.invoke(values)
        values=fixtures();values['host-manifest.json']['shared'].pop('runtimeManifest')
        with self.assertRaises(ValueError):self.invoke(values)
    def test_rejects_corrupt_generation_and_unsealed_entry(self):
        values=fixtures();values['runtime-manifest.json']['groups'][0]['current']['files'][0]['bytes']=5
        with self.assertRaises(ValueError):self.invoke(values)
        values=fixtures();values['host-manifest.json']['games']['th06']['runtime']='runtime/th06/th06.html'
        with self.assertRaises(ValueError):self.invoke(values,games=['th06'])
    def test_relay_guard_and_explicit_override(self):
        for value in ['wss://relay.example.com/','ws://user:secret@localhost/','https://localhost/']:
            with self.assertRaises(ValueError):require_local_relay(value)
        self.assertEqual(require_local_relay('ws://[::1]:9000/'),'ws://[::1]:9000/')
        values=fixtures();values['host-manifest.json']['shared']['netplayRelay']='wss://relay.example.com/'
        with self.assertRaises(ValueError):self.invoke(values,games=['th06mp'])
        self.assertEqual(self.invoke(values,games=['th06mp'],relay_override='ws://localhost:9000/'),'http://127.0.0.1:8000/nested/')

class LocationReplacementTests(unittest.TestCase):
    def javascript(self, assertions):
        # Execute the actual browser-side helper functions against a read-only
        # WindowProxy model. No browser, HTTP service or Playwright is involved.
        sources = json.dumps({'read':RUNTIME_FRAME_URL_JS,'closed':RUNTIME_FRAME_CLOSED_JS,'observe':RUNTIME_EVENT_OBSERVER_JS})
        script = """
import assert from 'node:assert/strict';
const sources = SOURCES;
const read = eval('(' + sources.read + ')'), closed = eval('(' + sources.closed + ')');
const observe = eval('(' + sources.observe + ')');
const initial = 'http://127.0.0.1:8000/nested/runtime/th06/' + 'a'.repeat(64) + '/th06.html?managedData=1&runtimeEpoch=7';
globalThis.location = {origin:'http://127.0.0.1:8000'};
const frame = {src:'',getAttribute:()=>null,contentWindow:{location:{href:initial}}};
globalThis.window=globalThis;window.top=window;
globalThis.document={querySelector:selector=>{assert.equal(selector,'[data-runtime-host] iframe');return frame;}};
let listener;globalThis.addEventListener=(type,callback)=>{assert.equal(type,'message');listener=callback;};
const observed=[];window.record=async value=>{observed.push(value);};
const emit=(message={},envelope={})=>listener({source:frame.contentWindow,origin:location.origin,
  data:{protocol:'eagler-touhou/1',game:'th06',epoch:7,event:'first-frame',...message},...envelope});
ASSERTIONS
""".replace('SOURCES',sources).replace('ASSERTIONS',assertions)
        completed=subprocess.run(['node','--input-type=module','-'],input=script,text=True,capture_output=True)
        self.assertEqual(completed.returncode,0,completed.stderr)

    def test_location_replace_url_and_exit_ignore_empty_src_attribute(self):
        self.javascript("""
assert.equal(frame.src,'');assert.equal(frame.getAttribute('src'),null);
assert.equal(read(frame),initial);assert.equal(closed(frame),false);
frame.contentWindow.location.href='about:blank';
assert.equal(read(frame),'');assert.equal(closed(frame),true);
frame.contentWindow.location.href='https://foreign.example/runtime/th06/th06.html?runtimeEpoch=7';
assert.throws(()=>read(frame),/same-origin/);assert.equal(closed(frame),false);
Object.defineProperty(frame.contentWindow,'location',{get(){throw Error('cross-origin access denied');}});
assert.throws(()=>read(frame),/denied/);assert.equal(closed(frame),false);
""")

    def test_observer_accepts_real_location_epoch_and_fences_all_envelope_fields(self):
        self.javascript("""
observe({callback:'record',game:'th06'});emit();assert.equal(observed.length,1);
assert.equal(observed[0].src,initial);assert.equal(observed[0].epoch,7);
for(const changed of [{protocol:'wrong'},{game:'th07'},{epoch:6},{epoch:'7'},{event:''}])emit(changed);
emit({}, {source:{}});emit({}, {origin:'https://foreign.example'});
assert.equal(observed.length,1);
frame.contentWindow.location.href=initial.replace('runtimeEpoch=7','runtimeEpoch=8');
emit();assert.equal(observed.length,1);emit({epoch:8});assert.equal(observed.length,2);
assert.equal(observed[1].epoch,8);
frame.contentWindow.location.href='about:blank';emit({epoch:8});assert.equal(observed.length,2);
""")

    def test_observer_can_infer_game_but_never_accepts_foreign_document(self):
        self.javascript("""
observe({callback:'record',game:null});emit();assert.equal(observed.length,1);
emit({game:'th07'});assert.equal(observed.length,1);
frame.contentWindow.location.href='https://foreign.example/runtime/th06/th06.html?runtimeEpoch=7';
emit();assert.equal(observed.length,1);
Object.defineProperty(frame.contentWindow,'location',{get(){throw Error('access denied');}});
emit();assert.equal(observed.length,1);
""")

    def test_runtime_url_uses_document_reader_not_src_attribute(self):
        expected='http://localhost/runtime/th06/epoch/th06.html?runtimeEpoch=7'
        class Frame:
            def get_attribute(self,_):raise AssertionError('src attribute does not own Runtime navigation')
            def evaluate(self,source):
                assert source==RUNTIME_FRAME_URL_JS
                return expected
        class Page:
            def locator(self,selector):
                assert selector=='[data-runtime-host] iframe'
                return Frame()
        self.assertEqual(runtime_url(Page()),expected)

class LaunchWarningTests(unittest.TestCase):
    class Page:
        def __init__(self, warnings):self.warnings=list(warnings);self.clicked=[];self.delays=[]
        def locator(self, selector):
            assert selector == '[data-launch-warning]:visible'
            return self
        def count(self):return int(bool(self.warnings))
        def get_attribute(self, name):
            assert name == 'data-launch-warning'
            return self.warnings[0]
        def get_by_role(self, role, **options):
            assert role == 'button' and options == {'name':'Start anyway','exact':True}
            return self
        def click(self):self.clicked.append(self.warnings.pop(0))
        def wait_for_timeout(self, delay):self.delays.append(delay)
    def test_only_explicit_known_launch_prompts_are_acknowledged(self):
        page=self.Page(['touch.disabledInputWarning','music.noneLaunchWarning'])
        wait_for_launch_action(page,lambda:not page.warnings)
        self.assertEqual(page.clicked,['touch.disabledInputWarning','music.noneLaunchWarning'])
    def test_completion_does_not_accept_later_unrelated_dialogs(self):
        page=self.Page(['music.midiLaunchWarning'])
        wait_for_launch_action(page,lambda:True)
        self.assertEqual(page.clicked,[])
    def test_unknown_warning_is_never_accepted(self):
        page=self.Page(['save.lossRisk'])
        with self.assertRaisesRegex(AssertionError,'Unexpected launch warning'):
            wait_for_launch_action(page,lambda:False)
        self.assertEqual(page.clicked,[])

class PreflightAuditTests(unittest.TestCase):
    def test_actual_cli_observer_fences_epoch_and_reads_native_memory_without_owning_it(self):
        tree=ast.parse((Path(__file__).parent/'test-mp-runtime-exit-room.py').read_text())
        source=next(node.value.value for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='PREFLIGHT_AUDIT' for target in node.targets))
        script="""
import assert from 'node:assert/strict';import vm from 'node:vm';
const source=SOURCE,records=[],listeners=new Map(),parent={};
const origin='http://127.0.0.1:8900',href=origin+'/nested/runtime/th08/multiplayer/'+ 'a'.repeat(64)+'/th08.html?runtimeEpoch=9';
const memory=new WebAssembly.Memory({initial:1}),child={location:{href},WebAssembly,__th08Runtime:{app:4,core:{memory}}};
const frame={contentWindow:child},topWindow={};topWindow.top=topWindow;
const context={window:topWindow,location:{origin},URL,document:{querySelector:()=>frame},__recordPreflight:async record=>records.push(record),addEventListener:(name,listener)=>listeners.set(name,listener)};
vm.runInNewContext('('+source+')("th08")',context);
const emit=(data={},patch={})=>listeners.get('message')({source:child,origin,data:{protocol:'eagler-touhou/1',game:'th08',epoch:9,event:'first-frame',...data},...patch});
emit();assert.equal(records.length,1);assert.equal(records[0].nativeWasm,true);assert.equal(records[0].epoch,9);
for(const data of [{epoch:8},{game:'th07'},{protocol:'wrong'}])emit(data);
emit({}, {source:{}});emit({}, {origin:'https://foreign.example'});assert.equal(records.length,1);
child.location.href='about:blank';emit();assert.equal(records.length,1);assert.equal(child.__th08Runtime.core.memory,memory);
const commands=[],childListeners=new Map(),childContext={window:{top:{}},parent,location:{origin,href},URL,__recordPreflight:async record=>commands.push(record),addEventListener:(name,listener)=>childListeners.set(name,listener)};
vm.runInNewContext('('+source+')("th08")',childContext);
const configure=(patch={})=>childListeners.get('message')({source:parent,origin,data:{protocol:'eagler-touhou/1',game:'th08',epoch:9,command:'configure',options:{multiplayerPreflight:true},...patch}});
configure();configure({epoch:8});configure({game:'th07'});assert.equal(commands.length,1);assert.equal(commands[0].options.multiplayerPreflight,true);
""".replace('SOURCE',json.dumps(source))
        result=subprocess.run(['node','--input-type=module','-'],input=script,text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__':unittest.main()
