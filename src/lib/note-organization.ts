export const categoryParts=(path:string)=>path.split('/').map(p=>p.trim()).filter(Boolean);
export const categoryPath=(path:string)=>categoryParts(path).join(' / ');
export const inCategory=(path:string,parent:string)=>!parent || categoryPath(path)===categoryPath(parent)||categoryPath(path).startsWith(categoryPath(parent)+' / ');
export function categoryPaths(values:string[]){const paths=new Set<string>();for(const value of values){const parts=categoryParts(value);parts.forEach((_,i)=>paths.add(parts.slice(0,i+1).join(' / ')));}return [...paths].sort((a,b)=>a.localeCompare(b,'ja'));}
export function movedCategory(path:string,from:string,to:string){return inCategory(path,from)?to+categoryPath(path).slice(categoryPath(from).length):categoryPath(path);}
export const searchTerms=(query:string)=>query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
export function matchesSearch(text:string,query:string){const haystack=text.normalize('NFKC').toLocaleLowerCase();return searchTerms(query).every(term=>haystack.includes(term));}
export function searchExcerpt(text:string,query:string){const terms=searchTerms(query);const folded=text.normalize('NFKC').toLocaleLowerCase();const hits=terms.map(t=>folded.indexOf(t)).filter(i=>i>=0);const start=hits.length?Math.max(0,Math.min(...hits)-35):0;return (start?'…':'')+text.slice(start,start+150)+(text.length>start+150?'…':'');}
export type CategoryNode={path:string;label:string;children:CategoryNode[]};
export function categoryTree(paths:string[]):CategoryNode[]{const roots:CategoryNode[]=[];const byPath=new Map<string,CategoryNode>();for(const path of categoryPaths(paths)){const parts=categoryParts(path);const node={path,label:parts.at(-1)!,children:[]};byPath.set(path,node);const parent=byPath.get(parts.slice(0,-1).join(' / '));(parent?parent.children:roots).push(node);}return roots;}
