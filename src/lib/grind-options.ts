import type {GrindLookup} from "./types";
export function dropdownGrinds(grinds:GrindLookup[]){
  return Array.from({length:13},(_,i)=>String(i+5)).flatMap(value=>grinds.filter(grind=>grind.grind_value===value));
}
