'use strict';

// Prisma can schedule independent relation reads concurrently inside one
// interactive transaction. pg requires operations on that connection to be
// serialized. Keep pool queries and separate transactions fully independent.
function serializeTransaction(transaction) {
  let tail=Promise.resolve();
  const operations=new Set(['queryRaw','executeRaw','commit','rollback','createSavepoint','rollbackToSavepoint','releaseSavepoint']);
  return new Proxy(transaction,{
    get(target,key){
      const value=Reflect.get(target,key,target);
      if(typeof value!=='function')return value;
      if(!operations.has(key))return value.bind(target);
      return (...args)=>{
        const result=tail.then(()=>value.apply(target,args));
        // Keep the queue usable for rollback after a rejected SQL operation.
        tail=result.then(()=>undefined,()=>undefined);
        return result;
      };
    },
  });
}
function serializePgTransactions(factory){
  return new Proxy(factory,{
    get(target,key){
      if(key==='connect')return async(...args)=>{
        const adapter=await target.connect(...args);
        return new Proxy(adapter,{
          get(connection,name){
            const value=Reflect.get(connection,name,connection);
            if(name==='startTransaction')return async(...input)=>serializeTransaction(await value.apply(connection,input));
            return typeof value==='function'?value.bind(connection):value;
          },
        });
      };
      const value=Reflect.get(target,key,target);
      return typeof value==='function'?value.bind(target):value;
    },
  });
}
module.exports={serializePgTransactions,serializeTransaction};
