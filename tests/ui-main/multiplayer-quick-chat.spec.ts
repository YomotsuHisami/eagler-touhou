import {test, expect} from './synthetic-ui-test';
import type {Page} from '@playwright/test';

const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
async function load(page: Page) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(`${origin}/__ui_tests__/multiplayer-quick-chat.html`);
  await expect(page.getByRole('button', {name: 'Tap for quick chat'})).toBeVisible();
  await expect(page.locator('[data-current-session]')).toHaveText('th06mp-1234:1');
}

test('synthetic quick chat sends the live room/run, mutes, expires, and remains portaled in fullscreen without moving iframe focus', async ({page}, info) => {
  info.annotations.push({type: 'synthetic-data', description: 'Controlled presentation ports only. No live Multiplayer Room, relay, Runtime, game code, or gameplay acceptance is exercised.'});
  await load(page);
  const iframe = page.locator('#focus-sentinel');
  await page.evaluate(() => (document.getElementById('focus-sentinel') as HTMLIFrameElement).focus());
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('focus-sentinel');

  const prompt = page.getByRole('button', {name: 'Tap for quick chat'});
  await prompt.click();
  await page.locator('[data-phrase="request-life"]').click();
  await expect.poll(() => page.evaluate(() => window.__quickChatFixture.inspect().sent)).toEqual([
    {room: 'th06mp-1234', serial: 1, phraseId: 'request-life'},
  ]);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('focus-sentinel');

  await page.getByRole('button', {name: 'Switch synthetic session'}).click();
  await expect(page.locator('[data-current-session]')).toHaveText('th06mp-5678:2');
  await expect(page.locator('.mp-quick-chat-picker')).toHaveCount(0);
  await prompt.click();
  await page.locator('[data-phrase="thanks"]').click();
  await expect.poll(() => page.evaluate(() => window.__quickChatFixture.inspect().sent)).toEqual([
    {room: 'th06mp-1234', serial: 1, phraseId: 'request-life'},
    {room: 'th06mp-5678', serial: 2, phraseId: 'thanks'},
  ]);
  await page.evaluate(() => {window.__quickChatFixture.emit('follow-me'); window.__quickChatFixture.emitStale();});
  const log = page.getByRole('log');
  await expect(log).toContainText('Peer Player');
  await expect(log).toContainText('Follow me');
  await expect(log.locator('p')).toHaveCount(1);

  await prompt.click();
  await page.getByRole('button', {name: 'Mute messages'}).click();
  const peerMute = page.getByRole('button', {name: /P2 Peer Player · Mute messages/});
  await peerMute.click();
  await expect(log).toBeEmpty();
  await page.getByRole('button', {name: 'Back to quick chat'}).click();
  await prompt.click();
  await page.getByRole('button', {name: 'Mute messages'}).click();
  await page.getByRole('button', {name: /P2 Peer Player · Unmute messages/}).click();
  await expect(log).toContainText('Follow me');

  await page.getByRole('button', {name: 'Back to quick chat'}).click();
  await page.getByRole('button', {name: 'Fullscreen player surface'}).click();
  await expect.poll(() => page.evaluate(() => window.__quickChatFixture.inspect().fullscreen)).toBe(true);
  await expect(page.locator('[data-player-surface] .mp-quick-chat')).toBeVisible();
  expect(await iframe.evaluate(element => element.isConnected)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__quickChatFixture.inspect().entries), {timeout: 4500}).toBe(0);
  await expect(page.locator('[data-player-surface] .mp-quick-chat')).toBeVisible();
});
