import {defineConfig, devices} from '@playwright/test';
export default defineConfig({
  testDir:'tests/ui-main-nested', outputDir:'.cache/ui-main-nested-results',
  reporter:[['list'],['html',{outputFolder:'.cache/ui-main-nested-report',open:'never'}]],
  use:{baseURL:'http://127.0.0.1:4177',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'node scripts/serve-ui.mjs --root=.cache/build/ui-main-nested/client --port=4177',url:'http://127.0.0.1:4177/nested-launcher/',reuseExistingServer:false},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari']}}],
});
