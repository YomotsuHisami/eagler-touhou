import {defineConfig} from 'vite';
import {reactRouter} from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import {browserContractSources} from './scripts/vite-contracts.ts';
import {uiBuildConfig} from './scripts/ui-build-config.mjs';
export default defineConfig({base: uiBuildConfig().mountPath, plugins: [browserContractSources(), tailwindcss(), reactRouter()], publicDir: false});
