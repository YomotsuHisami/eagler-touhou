import assert from 'node:assert/strict';
import {accentFromPixels} from '../../../src/launcher/cover-accent.mts';
for(const [pixels,expected] of [[[], '#d0cbc3'],[[128,128,128,255],'#d0cbc3'],[[255,0,0,0],'#d0cbc3'],[[255,0,0,255],'hsl(0 62% 78%)'],[[0,255,0,255],'hsl(120 62% 78%)'],[[0,0,255,255],'hsl(240 62% 78%)']])assert.equal(accentFromPixels(pixels),expected);
assert.equal(accentFromPixels([255,0,0,255,0,255,0,255,0,255,0,255]),'hsl(120 62% 78%)');
console.log('PASS shared cover accent: neutral, transparent, primary hues and weighted dominance');
