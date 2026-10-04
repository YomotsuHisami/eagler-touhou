import {defineConfig,devices} from '@playwright/test';
import {previewFixture,publicationFixtures} from './tests/publication/fixture-addresses';
export default defineConfig({testDir:'tests/publication',testMatch:'**/*.spec.ts',fullyParallel:false,workers:1,timeout:60000,
 outputDir:'.cache/ui-publication-results',reporter:[['list'],['html',{outputFolder:'.cache/ui-publication-report',open:'never'}]],
 use:{trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:[
  {command:`node scripts/serve-ui.mjs --port=${previewFixture.port}`,url:previewFixture.origin+'/',reuseExistingServer:false},
  ...publicationFixtures.map(({name,port,origin,mount})=>({command:`node tests/publication/serve-fixtures.mjs ${name} ${port}`,env:{EAGLER_UI_PUBLICATION_FIXTURE:'1'},url:origin+mount,reuseExistingServer:false})),
 ],projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari']}}]});
