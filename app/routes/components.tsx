import { useState } from 'react';
import { Button, Dialog, Sheet, SettingsGroup, SettingsRow, SettingsSwitch } from '../ui';

/** Shared primitives are exercised together, independent of Runtime availability. */
export default function ComponentsRoute() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [density, setDensity] = useState('comfortable');
  return <section style={{ maxWidth: 800, padding: 24 }}>
    <h1>界面组件</h1><p>同一套主题、焦点与动作行为，用于游戏设置和文件管理。</p>
    <SettingsGroup title="操作按钮">
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={() => setDialogOpen(true)}>打开对话框</Button>
        <Button onClick={() => setSheetOpen(true)}>打开侧面板</Button>
        <Button variant="ghost">次要操作</Button><Button variant="danger">危险操作</Button><Button disabled>不可用</Button>
      </div>
    </SettingsGroup>
    <SettingsGroup title="设置行" description="标签、说明和控制器使用统一间距。">
      <SettingsSwitch label="示例开关" description="键盘空格和点击标签均可切换" checked={enabled} onCheckedChange={setEnabled} />
      <SettingsRow label="显示密度" htmlFor="showcase-density" description="原生选择框保持平台键盘行为">
        <select id="showcase-density" value={density} onChange={event => setDensity(event.target.value)}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select>
      </SettingsRow>
    </SettingsGroup>
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="界面设置" description="按 Escape、点击遮罩或关闭按钮可关闭" footer={<Button variant="primary" onClick={() => setDialogOpen(false)}>完成</Button>}>
      <SettingsSwitch label="示例开关" checked={enabled} onCheckedChange={setEnabled} />
      <SettingsRow label="共享状态"><span>{enabled ? '已开启' : '已关闭'}</span></SettingsRow>
    </Dialog>
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="设置侧面板" description="手机屏幕使用底部面板，桌面使用右侧面板" footer={<Button onClick={() => setSheetOpen(false)}>完成</Button>}>
      <SettingsSwitch label="示例开关" description="与页面和对话框共享受控状态" checked={enabled} onCheckedChange={setEnabled} />
    </Sheet>
  </section>;
}
