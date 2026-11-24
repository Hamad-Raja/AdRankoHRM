'use strict';
const JSZip=require('jszip'),ApiError=require('./ApiError');
const MAX_FILE=2*1024*1024,MAX_XML=2*1024*1024,MAX_TOTAL=8*1024*1024;
const invalid=message=>{throw new ApiError(400,message,'WORKBOOK_INVALID');};
// Restricted OOXML reader: no DTDs, entity declarations, formulas or active content.
// Accepts normal inline/shared-string XLSX cells; never evaluates spreadsheet values.
function xml(text){
 if(/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(text))invalid('XML declarations and CDATA are unsupported.');
 const root={name:'root',attrs:{},children:[],text:''},stack=[root];let offset=0,nodes=0;
 const decode=value=>value.replace(/&([^;]+);/g,(_,entity)=>{if(({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[entity])return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[entity];if(/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity)){const code=entity[1]==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));if(code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff))return String.fromCodePoint(code);}invalid('Unsupported XML entity.');});
 const tokens=/<!--[\s\S]*?-->|<\?xml\s[\s\S]*?\?>|<[^>]*>|[^<]+/g;let match;
 while((match=tokens.exec(text))){if(match.index!==offset)invalid('Malformed workbook XML.');offset=tokens.lastIndex;const token=match[0];if(token.startsWith('<!--')||token.startsWith('<?xml'))continue;
  if(token.startsWith('</')){const name=token.slice(2,-1).trim();if(stack.length<2||stack.pop().qualified!==name)invalid('Unbalanced workbook XML.');}
  else if(token.startsWith('<')){const tag=/^<([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)>$/.exec(token);if(!tag)invalid('Unsupported XML markup.');let attrs={},rest=tag[2];while(rest.trim()){const attribute=/^\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/.exec(rest);if(!attribute||Object.hasOwn(attrs,attribute[1]))invalid('Invalid XML attribute.');attrs[attribute[1]]=decode(attribute[2]??attribute[3]);rest=rest.slice(attribute[0].length);}const node={name:tag[1].split(':').at(-1),qualified:tag[1],attrs,children:[],text:''};stack.at(-1).children.push(node);if(++nodes>100000||stack.length>32)invalid('Workbook XML complexity limit exceeded.');if(!tag[3])stack.push(node);}
  else{if(token.includes('&')&&/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(token))invalid('Invalid XML text.');stack.at(-1).text+=decode(token);}
 }
 if(offset!==text.length||stack.length!==1||root.children.length!==1||root.text.trim())invalid('Malformed workbook XML.');return root.children[0];
}
const child=(node,name)=>node?.children.filter(item=>item.name===name)||[];
const texts=node=>node.name==='t'?node.text:node.children.map(texts).join('');
async function readWorkbook(buffer){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_FILE)invalid('Use an XLSX file up to 2 MB.');
 let zip;try{zip=await JSZip.loadAsync(buffer);}catch{invalid('Invalid or encrypted XLSX file.');}
 const entries=Object.values(zip.files).filter(entry=>!entry.dir);if(entries.length>80)invalid('Too many workbook parts.');let total=0;const files={};
 for(const entry of entries){const name=entry.name;if(name.includes('..')||name.startsWith('/')||entry.unsafeOriginalName&&entry.unsafeOriginalName!==name||!(/^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/[\w.-]+\.xml|xl\/(?:workbook\.xml|styles\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml|theme\/theme\d+\.xml))$/.test(name)))invalid('Unsupported workbook part; macros, links and embedded objects are not accepted.');
  if(entry._data?.uncompressedSize>MAX_XML)invalid('Workbook part exceeds size limit.');
  const data=await new Promise((resolve,reject)=>{let size=0,chunks=[];const stream=entry.internalStream('nodebuffer');stream.on('data',chunk=>{size+=chunk.length;total+=chunk.length;if(size>MAX_XML||total>MAX_TOTAL){stream.pause();reject(new ApiError(413,'Workbook expanded size limit exceeded.','WORKBOOK_TOO_LARGE'));}else chunks.push(chunk);}).on('error',reject).on('end',()=>resolve(Buffer.concat(chunks))).resume();});
  const value=data.toString('utf8');if(value.includes('\ufffd')||/\u0000/.test(value))invalid('Use UTF-8 workbook XML.');files[name]=xml(value);
 }
 for(const [name,node]of Object.entries(files)){if(name.endsWith('.rels'))for(const rel of child(node,'Relationship'))if(rel.attrs.TargetMode==='External'||/^\w+:|^\/|\.\./.test(rel.attrs.Target||''))invalid('External workbook links are not allowed.');}
 const types=files['[Content_Types].xml'];if(!types||types.children.some(item=>/macroEnabled|vbaProject/i.test(item.attrs.ContentType||'')))invalid('Macro-enabled workbooks are not accepted.');
 const workbook=files['xl/workbook.xml'],rels=child(files['xl/_rels/workbook.xml.rels'],'Relationship'),sheets=child(child(workbook,'sheets')[0],'sheet');
 if(sheets.length!==3)invalid('Use the three-sheet payroll adjustment template.');
 const shared=child(files['xl/sharedStrings.xml'],'si').map(texts),result={};
 for(const sheet of sheets){const name=sheet.attrs.name;if(!['Instructions','Payroll','Adjustments'].includes(name)||result[name])invalid('Unexpected or duplicate template sheet.');const rel=rels.find(item=>item.attrs.Id===sheet.attrs['r:id']);if(!rel||!/^worksheets\/sheet\d+\.xml$/.test(rel.attrs.Target))invalid('Invalid worksheet relationship.');const node=files['xl/'+rel.attrs.Target];if(!node||node.children.some(item=>['externalLinks','oleObjects','legacyDrawing'].includes(item.name)))invalid('Unsupported worksheet content.');
  const rows=child(child(node,'sheetData')[0],'row');if(rows.length>1301)invalid('Template row limit exceeded.');const output=[],seen=new Set();
  for(const row of rows){const rowNo=Number(row.attrs.r);if(!Number.isInteger(rowNo)||rowNo<1||rowNo>1301||seen.has(rowNo))invalid('Invalid or duplicate worksheet row.');seen.add(rowNo);const cells=[],references=new Set();for(const cell of child(row,'c')){const reference=/^([A-Z]{1,2})([0-9]+)$/.exec(cell.attrs.r||'');if(!reference||Number(reference[2])!==rowNo||references.has(reference[1]))invalid('Invalid cell reference.');references.add(reference[1]);let col=0;for(const char of reference[1])col=col*26+char.charCodeAt(0)-64;if(col>16)invalid('Template column limit exceeded.');if(child(cell,'f').length||['e','b','d'].includes(cell.attrs.t))invalid(name+' row '+rowNo+': formulas and unsupported cell types are not allowed.');const value=child(cell,'v')[0]?.text||'';let text;if(cell.attrs.t==='s'){if(!/^\d+$/.test(value)||shared[Number(value)]===undefined)invalid('Invalid shared string.');text=shared[Number(value)];}else if(cell.attrs.t==='inlineStr')text=texts(cell);else if(!cell.attrs.t||cell.attrs.t==='n'||cell.attrs.t==='str')text=value;else invalid('Unsupported cell type.');if(text.length>1000||/^[=+@]/.test(text.trim()))invalid(name+' row '+rowNo+': unsupported value or formula-like content.');cells[col-1]=text;}
   output.push({row:rowNo,cells});
  }result[name]=output.sort((a,b)=>a.row-b.row);
 }
 return result;
}
module.exports={readWorkbook};
