import {useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {useSearchParams} from 'react-router';
import {gameIdForProduct} from '../../src/contracts/product-catalog.mts';
import {touchMovementUsesJoystick} from '../../src/launcher/game-preferences.mts';
import {functionKeyGames} from '../../src/launcher/touch-function-key.mts';
import {touchLayoutControlNames, touchLayoutControlMeta, touchLayoutScaleMin, touchLayoutScaleMax, type TouchLayoutControlName} from '../../src/launcher/touch-layout-model.mts';
import {useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {useNavigationDraftGuard} from './NavigationDrafts';
import type {PreferencesSnapshot, PreferencesStore} from '../services/preferences.client';
import type {LayoutRect, TouchLayoutGeometry, TouchLayoutSnapshot, TouchLayoutStore} from '../services/touch-layout.client';
import {TouchSettingsFields} from './TouchSettingsFields';
import {TouchControlCopy} from './TouchControl';
import {useTouchLayoutStore, useTouchLayoutSnapshot} from './TouchLayoutProvider';
import './touch-layout-editor.css';
import '../runtime/runtime-viewport.css';

const buttonClass = 'min-h-11 rounded-xl border border-line px-3 py-2 text-xs hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
export function TouchLayoutEditor({settings, preferences}: {settings: PreferencesSnapshot; preferences: PreferencesStore}) {
  const store = useTouchLayoutStore(), snapshot = useTouchLayoutSnapshot();
  const [params, setParams] = useSearchParams();
  const runtime = useRuntimeSnapshot();
  const opener = useRef<HTMLButtonElement>(null);
  const open = params.get('touchLayout') === '1';
  const running = !!runtime?.epoch;
  useNavigationDraftGuard({
    label: '触控按键布局',
    shouldBlock: (from, to) => !!store?.getSnapshot().dirty && new URLSearchParams(from.search).get('touchLayout') === '1' &&
      (from.pathname !== to.pathname || new URLSearchParams(to.search).get('touchLayout') !== '1'),
    save: () => { if (store && !store.save()) throw new Error('触控布局保存失败。修改仍在，请重试，或明确放弃后离开。'); },
    discard: () => store?.discard(),
  });
  function changeOpen(value: boolean) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value) next.set('touchLayout', '1'); else next.delete('touchLayout');
      return next;
    });
  }
  return <section className="my-6 grid gap-3 rounded-2xl border border-line p-4">
    <h2 className="text-base font-bold">按键布局</h2>
    <p className="text-xs leading-relaxed text-muted">各作品共用布局，横屏与竖屏分别保存。可拖动、缩放按键并调整游戏画面的水平位置。</p>
    <button ref={opener} type="button" className={buttonClass} disabled={!store || running} onClick={() => changeOpen(true)}>编辑按键布局</button>
    {running && <p className="text-xs text-muted">请先退出正在准备或运行的游戏，再编辑布局。</p>}
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[69] bg-black/80"/>
        <Dialog.Content className="touch-editor touch-controls-surface" onPointerDownOutside={event => event.preventDefault()} onCloseAutoFocus={event => {
          if (opener.current?.isConnected) {event.preventDefault();opener.current.focus();}
        }}>
          {store && snapshot && !running ? <TouchLayoutCanvas preferences={preferences} settings={settings} store={store} snapshot={snapshot} close={() => changeOpen(false)}/> : <div className="m-6 grid gap-4">
            <Dialog.Title>按键布局</Dialog.Title><Dialog.Description>请先退出正在准备或运行的游戏，再编辑布局。</Dialog.Description>
            <button className={buttonClass} onClick={() => changeOpen(false)}>关闭</button>
          </div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}

const asRect = (rect: DOMRect): LayoutRect => ({left: rect.left, top: rect.top, width: rect.width, height: rect.height});
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function visibleControls(settings: PreferencesSnapshot) {
  const options = settings.options;
  return touchLayoutControlNames.filter(name =>
    name === 'focus' ? options.touchFocusMode !== 'two-finger' :
    name === 'joystick' ? touchMovementUsesJoystick(options.touchMovementMode) :
    name === 'restart' ? options.restartButtonEnabled :
    name === 'function' ? functionKeyGames.has(gameIdForProduct(settings.productId)) :
    name === 'thpracTab' || name === 'thpracMenu' ? options.thpracTouchControlsEnabled : true);
}

type Gesture = {pointer: number; name: TouchLayoutControlName; x: number; y: number; kind: 'move'} |
  {pointer: number; name: TouchLayoutControlName; kind: 'resize'; left: number; top: number; width: number; height: number; scale: number} |
  {pointer: number; kind: 'viewport'; x: number} | {pointer: number; kind: 'workbench'; x: number; y: number};
function TouchLayoutCanvas({settings, preferences, store, snapshot, close}: {settings: PreferencesSnapshot; preferences: PreferencesStore; store: TouchLayoutStore; snapshot: TouchLayoutSnapshot; close(): void}) {
  const id = useId(), root = useRef<HTMLDivElement>(null), safe = useRef<HTMLDivElement>(null), reserved = useRef<HTMLDivElement>(null), workbench = useRef<HTMLDivElement>(null);
  const defaults = useRef(new Map<TouchLayoutControlName, HTMLButtonElement>());
  const gesture = useRef<Gesture | null>(null);
  const [geometry, setGeometry] = useState<TouchLayoutGeometry | null>(null);
  const [error, setError] = useState<string | null>(null), [status, setStatus] = useState('');
  const [collapsed, setCollapsed] = useState(false), [viewportEditing, setViewportEditing] = useState(false);
  const [panelPoint, setPanelPoint] = useState<{x: number; y: number} | null>(null);
  const [preview, setPreview] = useState<{x: number; y: number} | null>(null);
  const previewPointer = useRef<{pointer: number; x: number; y: number; point: {x: number; y: number}} | null>(null);
  const joystick = touchMovementUsesJoystick(settings.options.touchMovementMode);
  const visible = visibleControls(settings);
  const selected = visible.includes(snapshot.selected) ? snapshot.selected : visible[0];
  const item = snapshot.profile?.controls[selected];

  useLayoutEffect(() => {
    const host = root.current, zone = safe.current;
    if (!host || !zone) return;
    const measure = () => {
      try {
        const rect = host.getBoundingClientRect();
        const controls = Object.fromEntries(touchLayoutControlNames.map(name => {
          const node = defaults.current.get(name);
          if (!node) throw new Error(`缺少布局按钮：${name}`);
          return [name, asRect(node.getBoundingClientRect())];
        })) as Record<TouchLayoutControlName, LayoutRect>;
        const next: TouchLayoutGeometry = {orientation: rect.width >= rect.height ? 'landscape' : 'portrait', safe: asRect(zone.getBoundingClientRect()), controls, reserved: reserved.current ? asRect(reserved.current.getBoundingClientRect()) : undefined};
        store.setGeometry(next); setGeometry(next); setError(null);
        gesture.current = null; previewPointer.current = null; setPreview(null);
      } catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(host); observer.observe(zone);
    return () => {observer.disconnect();gesture.current = null;previewPointer.current = null;};
  }, [store, joystick]);

  useEffect(() => {if (snapshot.dirty) setStatus('');}, [snapshot.dirty]);

  useLayoutEffect(() => {
    const host = root.current?.getBoundingClientRect(), panel = workbench.current?.getBoundingClientRect();
    if (!host || !panel) return;
    const rangeX = Math.max(0, host.width - panel.width - 32), rangeY = Math.max(0, host.height - panel.height - 32);
    const point = snapshot.workbench;
    setPanelPoint(point ? {x: 16 + point.x * rangeX, y: 16 + point.y * rangeY}
      : {x: host.height > host.width ? (host.width - panel.width) / 2 : Math.max(16, host.width - panel.width - 16), y: Math.min(76, 16 + rangeY)});
  }, [snapshot.orientation, snapshot.workbench?.x, snapshot.workbench?.y, geometry?.safe.width, geometry?.safe.height, collapsed]);

  useLayoutEffect(() => {
    const host = root.current, panel = workbench.current;
    if (!host || !panel) return;
    const observer = new ResizeObserver(() => setPanelPoint(point => {
      if (!point) return point;
      const x = clamp(point.x, 16, Math.max(16, host.clientWidth - panel.offsetWidth - 16));
      const y = clamp(point.y, 16, Math.max(16, host.clientHeight - panel.offsetHeight - 16));
      return x === point.x && y === point.y ? point : {x, y};
    }));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  function begin(name: TouchLayoutControlName, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !geometry || !snapshot.profile?.controls[name]) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    store.select(name); store.bringToFront(name);
    const rect = event.currentTarget.getBoundingClientRect();
    gesture.current = event.target instanceof Element && !!event.target.closest('[data-resize]')
      ? {pointer: event.pointerId, name, kind: 'resize', left: rect.left, top: rect.top, width: rect.width, height: rect.height, scale: snapshot.profile.controls[name]!.scale}
      : {pointer: event.pointerId, name, kind: 'move', x: event.clientX, y: event.clientY};
  }
  function move(event: ReactPointerEvent) {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId || !geometry) return;
    event.preventDefault();
    if (drag.kind === 'move') {
      store.moveControl(drag.name, event.clientX - drag.x, event.clientY - drag.y); drag.x = event.clientX; drag.y = event.clientY;
    } else if (drag.kind === 'resize') {
      const projection = ((event.clientX - drag.left) * drag.width + (event.clientY - drag.top) * drag.height) / (drag.width ** 2 + drag.height ** 2);
      const scale = clamp(drag.scale * Math.max(.05, projection), touchLayoutScaleMin, touchLayoutScaleMax), factor = scale / drag.scale;
      store.updateControl(drag.name, {scale, x: (drag.left + drag.width * factor / 2 - geometry.safe.left) / geometry.safe.width, y: (drag.top + drag.height * factor / 2 - geometry.safe.top) / geometry.safe.height});
    } else if (drag.kind === 'viewport') {
      const width = root.current?.clientWidth ?? 1;
      store.setViewport((store.getSnapshot().profile?.viewport.x ?? 0) + (event.clientX - drag.x) / width); drag.x = event.clientX;
    } else {
      const host = root.current, panel = workbench.current;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (host && panel) setPanelPoint(point => ({x: clamp((point?.x ?? 16) + dx, 16, Math.max(16, host.clientWidth - panel.offsetWidth - 16)), y: clamp((point?.y ?? 16) + dy, 16, Math.max(16, host.clientHeight - panel.offsetHeight - 16))}));
      drag.x = event.clientX; drag.y = event.clientY;
    }
  }
  function end(event: ReactPointerEvent) {
    if (gesture.current?.pointer !== event.pointerId) return;
    if (gesture.current.kind === 'workbench' && panelPoint && root.current && workbench.current) {
      const rangeX = Math.max(0, root.current.clientWidth - workbench.current.offsetWidth - 32), rangeY = Math.max(0, root.current.clientHeight - workbench.current.offsetHeight - 32);
      store.setWorkbenchPosition({x: rangeX ? (panelPoint.x - 16) / rangeX : .5, y: rangeY ? (panelPoint.y - 16) / rangeY : .5});
    }
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const collisions = new Set(store.overlappingControls(visible));
  function defaultControl(name: TouchLayoutControlName) {
    return <button key={name} ref={node => {if (node) defaults.current.set(name, node);else defaults.current.delete(name);}} type="button" tabIndex={-1} className={`layout-control layout-${name}`}><TouchControlCopy name={name} game={gameIdForProduct(settings.productId)} focusMode={settings.options.touchFocusMode}/></button>;
  }
  return <div ref={root} data-joystick={joystick} className="touch-editor touch-controls-surface" onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-panel/60" style={{transform: `translateX(${(snapshot.profile?.viewport.x ?? 0) * 100}%)`}} aria-hidden="true"><div className="grid aspect-[4/3] h-full max-h-full w-full max-w-[133.333vh] place-items-center border border-line bg-background text-muted">游戏画面位置预览</div></div>
    <div ref={safe} className="layout-safe"/>
    <div ref={reserved} className="layout-reserved runtime-system-anchor">系统按钮预留区</div>
    <div className="layout-defaults" aria-hidden="true" inert><div className="layout-hud">{(['focus', 'fire', 'function', 'bomb'] as const).map(defaultControl)}</div>{(['joystick', 'escape', 'restart', 'thpracTab', 'thpracMenu'] as const).map(defaultControl)}</div>
    {!viewportEditing && geometry && snapshot.profile && visible.map(name => {
      const placed = snapshot.controls[name]!;
      return <button key={name} type="button" className={`layout-control layout-${name} layout-placed`} style={{left: placed.rect.left + placed.rect.width / 2, top: placed.rect.top + placed.rect.height / 2, zIndex: 10 + placed.priority, '--layout-scale': placed.scale} as CSSProperties}
        aria-label={`${touchLayoutControlMeta[name].title}：拖动调整位置，方向键微调`} aria-pressed={selected === name} data-collision={collisions.has(name)} onPointerDown={event => begin(name, event)} onFocus={() => store.select(name)} onKeyDown={event => {
          const step = event.shiftKey ? 10 : 1, delta = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[event.key];
          if (delta) {event.preventDefault();store.moveControl(name, delta[0], delta[1]);}
        }}><TouchControlCopy name={name} game={gameIdForProduct(settings.productId)} focusMode={settings.options.touchFocusMode}/><span className="layout-resize" data-resize="" aria-hidden="true">↘</span></button>;
    })}
    <div className="absolute inset-0 z-[1]" aria-hidden="true" onPointerDown={event => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      if (viewportEditing) gesture.current = {kind: 'viewport', pointer: event.pointerId, x: event.clientX};
      else if (!joystick) {const point = preview ?? {x: event.clientX, y: event.clientY};previewPointer.current = {pointer: event.pointerId, x: event.clientX, y: event.clientY, point};setPreview(point);}
    }} onPointerMove={event => {
      const drag = previewPointer.current;
      if (drag?.pointer !== event.pointerId || joystick || viewportEditing) return;
      const ratio = settings.options.touchSensitivity / 100;
      setPreview({x: clamp(drag.point.x + (event.clientX - drag.x) * ratio, 0, root.current?.clientWidth ?? 0), y: clamp(drag.point.y + (event.clientY - drag.y) * ratio, 0, root.current?.clientHeight ?? 0)});
    }} onPointerUp={() => {previewPointer.current = null;}} onPointerCancel={() => {previewPointer.current = null;}} onLostPointerCapture={() => {previewPointer.current = null;}}/>
    {preview && !joystick && !viewportEditing && <span aria-hidden="true" className="pointer-events-none absolute z-30 text-4xl text-accent" style={{left: preview.x, top: preview.y, transform: 'translate(-50%,-50%)'}}>＋</span>}
    <div ref={workbench} className="layout-workbench grid gap-3 rounded-2xl border border-line bg-panel/95 p-3 text-xs shadow-menu" style={panelPoint ? {left: panelPoint.x, top: panelPoint.y, transform: 'none'} : undefined}>
      <header className="flex items-center justify-between gap-2">
        <Dialog.Title className="cursor-move touch-none font-bold" onPointerDown={event => {
          if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = {kind: 'workbench', pointer: event.pointerId, x: event.clientX, y: event.clientY};
        }}>按键布局 · {snapshot.orientation === 'landscape' ? '横屏' : '竖屏'}</Dialog.Title>
        <button type="button" className={buttonClass} aria-expanded={!collapsed} aria-controls={`${id}-tools`} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '展开' : '收起'}</button>
      </header>
      <Dialog.Description className="text-muted">布局不会发送游戏按键。旋转设备或调整窗口方向可编辑另一方向。</Dialog.Description>
      {!collapsed && <div id={`${id}-tools`} className="grid gap-3">
        {error ? <p role="alert" className="text-accent">{error}</p> : <>
          <label className="grid gap-2" htmlFor={`${id}-control`}>选中按键<select id={`${id}-control`} className="min-h-11 rounded-xl border border-line bg-background px-2" value={selected} onChange={event => store.select(event.currentTarget.value as TouchLayoutControlName)}>{visible.map(name => <option key={name} value={name}>{touchLayoutControlMeta[name].title}</option>)}</select></label>
          <label className="grid gap-2" htmlFor={`${id}-scale`}>按键大小 {Math.round((item?.scale ?? 1) * 100)}%<input id={`${id}-scale`} type="range" className="min-h-11 accent-accent" min={touchLayoutScaleMin} max={touchLayoutScaleMax} step={.01} value={item?.scale ?? 1} onChange={event => store.updateControl(selected, {scale: Number(event.currentTarget.value)})}/></label>
          <div className="grid grid-cols-2 gap-2"><button type="button" className={buttonClass} onClick={() => store.bringToFront(selected)}>移到最前</button><button type="button" className={buttonClass} onClick={() => store.resetOrientation()}>恢复本方向默认</button></div>
          <label className="grid gap-2" htmlFor={`${id}-viewport`}>游戏画面水平位置<input id={`${id}-viewport`} type="range" className="min-h-11 accent-accent" min={-.5} max={.5} step={.01} value={snapshot.profile?.viewport.x ?? 0} onChange={event => store.setViewport(Number(event.currentTarget.value))}/></label>
          <div className="grid grid-cols-2 gap-2"><button type="button" className={buttonClass} onClick={() => setViewportEditing(!viewportEditing)}>{viewportEditing ? '调整完成' : '拖动画面'}</button><button type="button" className={buttonClass} onClick={() => store.setViewport(0)}>画面复位</button></div>
          <details><summary className="min-h-11 cursor-pointer py-3 font-bold">触控设置（自动保存）</summary><TouchSettingsFields settings={settings} store={preferences}/></details>
          {!joystick && <p className="text-muted">在空白处拖动可预览 {settings.options.touchSensitivity}% 触控灵敏度。</p>}
          {collisions.size > 0 && <p role="status" className="text-amber-300">部分按键重叠或进入系统预留区。可调整位置、大小或层叠顺序。</p>}
        </>}
      </div>}
      <p role="status" className="text-muted">{status || (snapshot.dirty ? '布局有未保存修改' : '布局与已保存设置一致')}</p>
      <div className="grid grid-cols-2 gap-2"><button type="button" className={buttonClass} onClick={close}>退出</button><button type="button" className={`${buttonClass} border-accent text-accent`} disabled={!!error || !geometry} onClick={() => setStatus(store.save() ? '布局已保存到当前浏览器' : '保存失败，修改仍保留在本次会话，请重试。')}>保存布局</button></div>
    </div>
  </div>;
}
