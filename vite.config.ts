import {defineConfig} from 'vite';
import {reactRouter} from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import {browserContractSources} from './scripts/vite-contracts.ts';
export default defineConfig({plugins: [browserContractSources(), tailwindcss(), reactRouter()], publicDir: false});
