type ZipEntry={name:Uint8Array<ArrayBuffer>;size:number;crc:number;offset:number;time:number;date:number};
const table=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
async function crc32(blob:Blob){
  let crc=0xffffffff;
  for(let offset=0;offset<blob.size;offset+=1024*1024){
    const bytes=new Uint8Array(await blob.slice(offset,offset+1024*1024).arrayBuffer());
    for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);
  }
  return (crc^0xffffffff)>>>0;
}
function header(size:number){const bytes=new Uint8Array(size);return{bytes,view:new DataView(bytes.buffer)};}
/** STORE keeps original binaries intact and builds the archive from bounded Blob parts. */
export class ZipStore{
  private parts:BlobPart[]=[];private entries:ZipEntry[]=[];private offset=0;private names=new Set<string>();
  private maxBytes:number;
  constructor(maxBytes=512*1024*1024){this.maxBytes=maxBytes;}
  async add(path:string,data:string|Blob){
    if(!path||path.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\x00-\x1f]/.test(path)||this.names.has(path))throw new Error('ZIPのファイル名が重複または不正です');
    const name=new TextEncoder().encode(path),blob=typeof data==='string'?new Blob([data],{type:'text/plain;charset=utf-8'}):data;
    if(name.length>65535||this.entries.length>=65535)throw new Error('ZIPの件数・ファイル名の上限を超えます');
    const next=this.offset+30+name.length+blob.size;
    const central=22+this.entries.reduce((sum,e)=>sum+46+e.name.length,0)+46+name.length;
    if(next+central>Math.min(this.maxBytes,0xffffffff))throw new Error('取り出すデータが512MBを超えます。フォルダかページを選んで分けて保存してください。');
    const crc=await crc32(blob),now=new Date(),time=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),date=((Math.max(1980,now.getFullYear())-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
    const {bytes,view}=header(30);view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x800,true);view.setUint16(10,time,true);view.setUint16(12,date,true);view.setUint32(14,crc,true);view.setUint32(18,blob.size,true);view.setUint32(22,blob.size,true);view.setUint16(26,name.length,true);
    this.parts.push(bytes.buffer,name.buffer,blob);this.entries.push({name,size:blob.size,crc,offset:this.offset,time,date});this.names.add(path);this.offset=next;
  }
  finish(){
    const start=this.offset;
    for(const e of this.entries){
      const {bytes,view}=header(46);view.setUint32(0,0x02014b50,true);view.setUint16(4,20,true);view.setUint16(6,20,true);view.setUint16(8,0x800,true);view.setUint16(12,e.time,true);view.setUint16(14,e.date,true);view.setUint32(16,e.crc,true);view.setUint32(20,e.size,true);view.setUint32(24,e.size,true);view.setUint16(28,e.name.length,true);view.setUint32(42,e.offset,true);
      this.parts.push(bytes.buffer,e.name.buffer);this.offset+=46+e.name.length;
    }
    const {bytes,view}=header(22);view.setUint32(0,0x06054b50,true);view.setUint16(8,this.entries.length,true);view.setUint16(10,this.entries.length,true);view.setUint32(12,this.offset-start,true);view.setUint32(16,start,true);this.parts.push(bytes.buffer);
    return new Blob(this.parts,{type:'application/zip'});
  }
}
