import {loadCompiledContract} from './load-compiled-contract.mjs';
const contract=await loadCompiledContract('netplay-timing');
export const {parseMeasuredNetplayTiming}=contract;
