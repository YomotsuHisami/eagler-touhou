import { CHARACTER_ART, CHARACTER_ART_IDS, CHARACTER_ART_SCHEMA, type CharacterArtId } from '../contracts/character-art.mjs';
let catalogPromise: Promise<Set<CharacterArtId>> | null = null;
/** Only fixed, locally imported file names are accepted. No remote image URLs. */
export function installedCharacterArt(): Promise<Set<CharacterArtId>> {
  return catalogPromise ??= fetch('assets/dairi/manifest.json', {cache:'no-store'})
    .then(async response => {
      if (!response.ok) throw Error('Portrait catalog unavailable');
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || !('schema' in value) ||
          value.schema !== CHARACTER_ART_SCHEMA || !('characters' in value) || !Array.isArray(value.characters)) {
        throw Error('Invalid portrait catalog');
      }
      return new Set(value.characters.filter((id: unknown): id is CharacterArtId =>
        typeof id === 'string' && (CHARACTER_ART_IDS as readonly string[]).includes(id)));
    }).catch(() => new Set<CharacterArtId>());
}
export function createCharacterPortrait(id: string): HTMLElement {
  const host = document.createElement('span');
  host.className = 'character-portrait';
  const known = (CHARACTER_ART_IDS as readonly string[]).includes(id);
  const key = id as CharacterArtId;
  host.dataset.character = id;
  host.dataset.artState = 'loading';
  const label = document.createElement('span'); label.className = 'character-art-placeholder';
  const name = document.createElement('strong'); name.textContent = known ? CHARACTER_ART[key].name : '角色';
  const hint = document.createElement('small'); hint.textContent = '立绘未导入';
  label.hidden = true;
  label.append(name, hint); host.append(label);
  const settle = (state: string) => { host.dataset.artState = state; host.dispatchEvent(new Event('portrait-ready')); };
  if (known) void installedCharacterArt().then(installed => {
    if (!installed.has(key)) { label.hidden = false; settle('missing'); return; }
    const image = document.createElement('img'); image.alt = CHARACTER_ART[key].name;
    image.decoding = 'async'; image.draggable = false;
    image.addEventListener('load', () => { label.hidden = true; host.classList.add('has-art'); host.title='DAIRI / はるか · 本地导入立绘'; settle('ready'); });
    image.addEventListener('error', () => { image.remove(); label.hidden = false; host.classList.remove('has-art'); hint.textContent = '立绘读取失败'; settle('missing'); });
    image.src = `assets/dairi/${key}.png`; host.append(image);
  });
  if (!known) { label.hidden = false; settle('missing'); }
  return host;
}
