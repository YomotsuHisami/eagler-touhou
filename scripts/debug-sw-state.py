import json
import sys
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8130/eagler-touhou/"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    page.goto(url, wait_until="load", timeout=30000)
    page.wait_for_timeout(4000)
    state = page.evaluate("""
      async () => {
        const registration = await navigator.serviceWorker.getRegistration('./');
        return {
          controller: navigator.serviceWorker.controller?.scriptURL || null,
          installing: registration?.installing ? {
            scriptURL: registration.installing.scriptURL,
            state: registration.installing.state,
          } : null,
          waiting: registration?.waiting ? {
            scriptURL: registration.waiting.scriptURL,
            state: registration.waiting.state,
          } : null,
          active: registration?.active ? {
            scriptURL: registration.active.scriptURL,
            state: registration.active.state,
          } : null,
          caches: await caches.keys(),
          statusNote: document.getElementById('serverStatusNote')?.textContent || '',
          statusKind: document.getElementById('serverStatusNote')?.dataset?.kind || '',
        };
      }
    """)
    print(json.dumps(state, ensure_ascii=False, indent=2))
    browser.close()
