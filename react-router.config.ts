import type {Config} from '@react-router/dev/config';
import {uiBuildConfig} from './scripts/ui-build-config.mjs';
const {mountPath, buildDirectory} = uiBuildConfig();
export default {ssr: false, basename: mountPath, buildDirectory} satisfies Config;
