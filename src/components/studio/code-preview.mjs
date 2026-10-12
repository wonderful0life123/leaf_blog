import {LanguageDescription} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {highlightCode, classHighlighter} from '@lezer/highlight';

// Plain text is always available; unknown languages and failed language loads keep it intact.
export async function codeSegments(code,language){
  const name=language.toLowerCase(),description=LanguageDescription.matchLanguageName(languages,name==='cuda'?'cpp':name,true);
  if(!description||code.length>100_000)return [{text:code,classes:''}];
  try{
    const support=await description.load(),segments=[];
    highlightCode(code,support.language.parser.parse(code),classHighlighter,(text,classes)=>segments.push({text,classes}),()=>segments.push({text:'\n',classes:''}));
    return segments;
  }catch{return [{text:code,classes:''}];}
}
