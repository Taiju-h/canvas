import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=workerURL;

/** All parsing, rendering and assets stay on the device, including offline. */
export async function readPdfPages(file:File,onPage:(blob:Blob,page:number,total:number)=>Promise<void>){
  if(file.size>64*1024*1024)throw new Error('PDFの読み込みは64MBまでです');
  const task=getDocument({data:new Uint8Array(await file.arrayBuffer()),
    cMapUrl:import.meta.env.BASE_URL+'assets/pdf-support/cmaps/',cMapPacked:true,
    standardFontDataUrl:import.meta.env.BASE_URL+'assets/pdf-support/standard_fonts/',
    wasmUrl:import.meta.env.BASE_URL+'assets/pdf-support/wasm/'});
  let pdf;
  try{
    pdf=await task.promise;
    if(pdf.numPages>200)throw new Error('PDFは200ページまでです。ページを分けて読み込んでください');
    for(let number=1;number<=pdf.numPages;number++){
      const page=await pdf.getPage(number),original=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:Math.min(2,1600/Math.max(original.width,original.height))});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvas,viewport}).promise;
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('PDFページを画像にできません')),'image/png'));
      await onPage(blob,number,pdf.numPages);page.cleanup();canvas.width=canvas.height=1;
    }
  }finally{await task.destroy();}
}
