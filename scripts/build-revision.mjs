import {execFileSync} from 'node:child_process';
export function commitTime(){
  try{return Number(execFileSync('git',['show','-s','--format=%ct','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim())||0;}catch{return 0;}
}
