import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'tests/publication',testMatch:'**/*.spec.ts',fullyParallel:false,workers:1,timeout:60000,
 outputDir:'.cache/ui-publication-results',reporter:[['list'],['html',{outputFolder:'.cache/ui-publication-report',open:'never'}]],
 use:{trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:[
  {command:'node scripts/serve-ui.mjs --port=4190',url:'http://127.0.0.1:4190',reuseExistingServer:false},
  {command:'node tests/publication/serve-fixtures.mjs root 4191',env:{EAGLER_UI_PUBLICATION_FIXTURE:'1'},url:'http://127.0.0.1:4191',reuseExistingServer:false},
  {command:'node tests/publication/serve-fixtures.mjs nested 4192',env:{EAGLER_UI_PUBLICATION_FIXTURE:'1'},url:'http://127.0.0.1:4192/nested-launcher/',reuseExistingServer:false},
 ],projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari']}}]});
