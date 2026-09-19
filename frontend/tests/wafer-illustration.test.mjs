import test from 'node:test';
import assert from 'node:assert/strict';
import {waferFailureTiles,waferTiles,WAFER_TILE_COUNT} from '../lib/rtdi/wafer-illustration.ts';

test('yield is shown proportionally with a bounded 0.25 percentage-point tile scale',()=>{
 for(const [yieldRatio,failed] of [[1,0],[.95,20],[.5,200],[.5375,185],[0,400]])
  assert.equal(waferFailureTiles(yieldRatio),failed);
 for(let i=0;i<=1000;i++){
  const y=i/1000, count=waferFailureTiles(y);
  assert.ok(Math.abs(count/WAFER_TILE_COUNT-(1-y))<=.00125000001);
 }
 for(const invalid of [undefined,NaN,Infinity,-.1,1.1])assert.equal(waferFailureTiles(invalid),null);
});
test('every die has a unique scatter rank and stays inside the wafer face',()=>{
 assert.equal(waferTiles.length,400);
 assert.equal(new Set(waferTiles.map(tile=>tile.rank)).size,400);
 assert.equal(new Set(waferTiles.map(tile=>tile.x+','+tile.y)).size,400);
 for(const tile of waferTiles){
  assert.ok(tile.rank>=0 && tile.rank<400);
  for(const dx of [-6.5,6.5])for(const dy of [-6.5,6.5])
   assert.ok(Math.hypot(tile.x+dx-200,tile.y+dy-200)<179);
 }
});
