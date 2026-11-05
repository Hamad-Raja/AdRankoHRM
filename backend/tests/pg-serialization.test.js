'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {serializeTransaction,serializePgTransactions}=require('../src/utils/serialized-pg');
test('one transaction serializes relation queries and rollback follows a rejected operation',async()=>{
 let active=0,max=0;const order=[];
 const tx=serializeTransaction({async queryRaw(value){max=Math.max(max,++active);order.push(value);await new Promise(r=>setImmediate(r));active--;if(value==='fail')throw new Error('synthetic SQL failure');return value;},async rollback(){assert.equal(active,0);order.push('rollback');}});
 const results=await Promise.allSettled([tx.queryRaw('first'),tx.queryRaw('fail'),tx.queryRaw('last'),tx.rollback()]);assert.equal(max,1);assert.equal(results[1].status,'rejected');assert.deepEqual(order,['first','fail','last','rollback']);
});
test('adapter pool queries and separate transactions remain independent',async()=>{
 let active=0,max=0;const run=async()=>{max=Math.max(max,++active);await new Promise(r=>setImmediate(r));active--;};
 const factory=serializePgTransactions({provider:'postgres',async connect(){return {queryRaw:run,async startTransaction(){return {queryRaw:run};}};}});
 const adapter=await factory.connect();await Promise.all([adapter.queryRaw(),adapter.queryRaw()]);assert.equal(max,2);max=0;
 const a=await adapter.startTransaction(),b=await adapter.startTransaction();await Promise.all([a.queryRaw(),b.queryRaw()]);assert.equal(max,2);
});
