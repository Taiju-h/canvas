import type {NoteDoc} from './notes';

function hasBody(html:string){
  return !!html.replace(/<[^>]*>/g,'').replace(/&nbsp;|\s/g,'')||/<(?:img|input|table)\b/i.test(html);
}

/** Old Notes/JEX stored the primary body in the first movable block. Read that
 * body in the Note layer, retaining its original block for a reversible save.
 * Never regenerate it from sourceMarkdown, which may predate the user's edits.
 */
export function migrateLegacyNoteBody(input:NoteDoc):NoteDoc {
  const body=input.blocks?.[0];
  if(!body||input.legacyNoteBody||hasBody(input.fixedNote?.html||''))return input;
  const imported=!!input.note?.sourceId&&input.note.sourceMarkdown!==undefined&&
    (!input.fixedNote||(!body.layerId&&body.x===80&&body.y===80));
  const oldNote=!!input.note&&!body.layerId&&!input.fixedNote&&!input.studioOrder&&
    (body.x===80||body.x===28)&&(body.y===60||body.y===80);
  if(!imported&&!oldNote)return input;
  // Attached ink depends on the block geometry. Leave annotated layouts intact.
  if(input.paintStrokes?.some(stroke=>stroke.blockId===body.id))return input;
  const layer=body.layerId?input.layers.find(layer=>layer.id===body.layerId):input.layers[0];
  return {...input,
    fixedNote:{visible:layer?.visible??true,locked:layer?.locked??false,opacity:layer?.opacity,...input.fixedNote,html:body.html},
    blocks:input.blocks!.slice(1),
    legacyNoteBody:{version:1,block:{...body}},
  };
}
