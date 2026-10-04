#!/usr/bin/env node
import {resolve} from 'node:path';
import {refreshUiDeployment} from '../lib/ui-refresh.mjs';
const values=process.argv.slice(2),root=values.find(value=>!value.startsWith('--'));
const frontend=values.includes('--frontend'),site=values.find(value=>value.startsWith('--site-url=')),artwork=values.find(value=>value.startsWith('--artwork-dir='));
if(!root||values.some(value=>![root,'--frontend',site,artwork].includes(value)))throw Error('usage: node scripts/refresh-deployment-app-shell.mjs <deployment-root> [--frontend] [--site-url=https://example.com/] [--artwork-dir=PATH]');
console.log(JSON.stringify(await refreshUiDeployment(resolve(root),{frontend,siteUrl:site?.slice('--site-url='.length),artworkRoot:artwork?resolve(artwork.slice('--artwork-dir='.length)):null})));
