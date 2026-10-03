import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'tests/ui',outputDir:'.cache/ui-browser-results',timeout:30000,fullyParallel:true,
 reporter:[['list'],['html',{outputFolder:'.cache/ui-browser-report',open:'never'}]],
 use:{baseURL:'http://127.0.0.1:5174',trace:'retain-on-failure',video:'on'},
 webServer:[{command:'node scripts/serve-ui.mjs --port=5174',url:'http://127.0.0.1:5174/index.html',reuseExistingServer:!process.env.CI,timeout:30000},{command:'node eagler-local-preview.mjs --offline=true --port=5175',url:'http://127.0.0.1:5175',reuseExistingServer:!process.env.CI,timeout:60000}],
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari']}},{name:'mobile-viewport',use:{...devices['iPhone 13'],defaultBrowserType:'webkit'}}],
});
