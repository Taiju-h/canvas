let count=0;
export function pauseNoteSync(){count++;let released=false;return()=>{if(!released){released=true;count=Math.max(0,count-1);}};}
export function noteSyncPaused(){return count>0;}
