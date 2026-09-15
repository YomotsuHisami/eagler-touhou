export async function seedFixture(game){
 const store=await import('/package/package-store.mjs');
 const descriptor=await (await fetch('/__fixture/'+game+'/package.json')).json();
 const generation={id:game+'-sdl-local-validation',game,descriptor,files:{}};
 for(const [id,file] of Object.entries(descriptor.files)){
  const response=await fetch('/'+file.source);if(!response.ok)throw Error('Fixture unavailable: '+file.source);
  const bytes=await response.arrayBuffer();
  generation.files[id]={objectId:await store.putPackageObject(bytes),revision:file.revision,storageMode:'arraybuffer'};
 }
 const operationId='sdl-local-validation-'+game;
 await store.stagePendingPackageGeneration(generation,{operationId,source:'local'});
 await store.commitPendingPackageGeneration(game,generation.id,{operationId,source:'local'});
}
