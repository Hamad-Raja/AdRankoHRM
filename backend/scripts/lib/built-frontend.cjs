'use strict';
// Bounded local fixture proxy for testing the actual build without Vite transforms.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
module.exports=async function serveBuilt(root,port,apiPort){
 if(![5174,5190].includes(port)||![3018,3040].includes(apiPort))throw Error('Unsupported isolated browser ports');
 const dist=path.join(root,'frontend/dist');if(!fs.existsSync(path.join(dist,'index.html')))throw Error('Run frontend build:vercel first.');
 const server=http.createServer((req,res)=>{
  if(req.url.split('?')[0].match(/^\/api(?:\/|$)/)){const proxy=http.request({host:'127.0.0.1',port:apiPort,path:req.url,method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res);});proxy.on('error',()=>{res.writeHead(503,{'content-type':'application/json'});res.end('{"success":false}');});req.pipe(proxy);return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  let file;try{file=path.resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));}catch{res.writeHead(400);res.end();return;}
  if(file!==dist&&!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){if(req.url.startsWith('/assets/')){res.writeHead(404);res.end();return;}file=path.join(dist,'index.html');}
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
 });
 server.kill=()=>{server.closeAllConnections();server.close();};await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'localhost',resolve);});return server;
};
