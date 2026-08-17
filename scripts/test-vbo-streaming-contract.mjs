import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

for (const game of ['th06', 'th07']) {
  const source = read(`${game}-eagler/src/graphics/Gles.cpp`);
  const beginStart = source.indexOf('void GlesGraphics::BeginFrame()');
  const beginEnd = source.indexOf('void GlesGraphics::EndFrame()', beginStart);
  if (beginStart < 0 || beginEnd < 0) throw new Error(`${game}: BeginFrame/EndFrame not found`);
  const begin = source.slice(beginStart, beginEnd);

  if (!source.includes('glGenBuffers(3, gfx->vbos);'))
    throw new Error(`${game}: transient VBO ring must remain triple-buffered`);
  const initialAllocations = source.match(/glBufferData\(GL_ARRAY_BUFFER, VBO_CAPACITY, nullptr, GL_DYNAMIC_DRAW\);/g)?.length || 0;
  if (initialAllocations < 1)
    throw new Error(`${game}: transient VBO ring must be allocated at initialization`);
  if (!begin.includes('curVbo = (curVbo + 1) % 3;') || !begin.includes('glBindBuffer(GL_ARRAY_BUFFER, vbos[curVbo]);'))
    throw new Error(`${game}: BeginFrame must rotate and bind the VBO ring`);
  if (game === 'th06') {
    if (!begin.includes('glBufferData(GL_ARRAY_BUFFER, VBO_CAPACITY, nullptr, GL_STREAM_DRAW);'))
      throw new Error(`${game}: BeginFrame must retain the known-safe per-frame VBO orphaning path`);
    if (!begin.includes('stateCache.Invalidate();'))
      throw new Error(`${game}: BeginFrame must retain full GL state-cache invalidation`);
  } else {
    if (!begin.includes('#ifndef __EMSCRIPTEN__') ||
        !begin.includes('glBufferData(GL_ARRAY_BUFFER, VBO_CAPACITY, nullptr, GL_STREAM_DRAW);'))
      throw new Error('th07: native BeginFrame must retain VBO orphaning');
    if (!begin.includes('stateCache.Invalidate();'))
      throw new Error('th07: BeginFrame must fully invalidate GL state on both Web and native');
    if (begin.includes('InvalidateVertexArray'))
      throw new Error('th07: unsafe VAO-only state-cache invalidation must not return');

    const swapStart = source.indexOf('void GlesGraphics::SwapBuffers()');
    if (swapStart < 0) throw new Error('th07: SwapBuffers not found');
    const swap = source.slice(swapStart);
    if (!swap.includes('glUseProgram(this->shaderProgram);') || !swap.includes('stateCache.Invalidate();'))
      throw new Error('th07: SwapBuffers must restore gameplay program and fully invalidate cached state');
    if (swap.includes('InvalidateVertexArray'))
      throw new Error('th07: unsafe VAO-only SwapBuffers invalidation must not return');
  }
  if (!source.includes('if (vboOffset + bytesNeeded > VBO_CAPACITY)') ||
      !source.includes('glBufferData(GL_ARRAY_BUFFER, VBO_CAPACITY, nullptr, GL_STREAM_DRAW);'))
    throw new Error(`${game}: VBO capacity overflow recovery must remain intact`);
}

console.log('TH06/TH07 safe VBO streaming contract: PASS');
