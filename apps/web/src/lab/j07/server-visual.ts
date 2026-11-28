import {createElement} from "react";
import sharp from "sharp";
import {renderToStaticMarkup} from "react-dom/server";
import {Sign,nameNeedsAdaptation,type Document,type Template,type View,type SignColors,type StudioLanguage} from "../../app/studio/studio-renderer";

export type StudioVisualConfig={data:Document;template:Template;view:View;palette:SignColors;lang:StudioLanguage;defaultBoard:boolean};
type Masters=Readonly<{jour:string;nuit:string}>;
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},"value"));
const text=(v:unknown,max:number):v is string=>typeof v==="string"&&v.length<=max&&!/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(v);
const color=(v:unknown):v is string=>typeof v==="string"&&/^#[0-9a-fA-F]{6}$/.test(v);
/** Accept only bounded PNG/JPEG, decode and re-encode pixels; no original metadata survives. */
async function normalizeLogo(value:unknown):Promise<string|null>{
 if(typeof value!=="string"||value.length>2_796_240)return null;
 const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match||match[2].length%4!==0)return null;
 const bytes=Buffer.from(match[2],"base64");
 if(!bytes.length||bytes.length>2*1024*1024||bytes.toString("base64")!==match[2])return null;
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if((match[1]==="png"&&!png)||(match[1]==="jpeg"&&!jpeg))return null;
 try{
  const image=sharp(bytes,{failOn:"warning",limitInputPixels:4096*4096,sequentialRead:true});
  const metadata=await image.metadata();
  if(metadata.format!==match[1]||!metadata.width||!metadata.height||metadata.width>4096||metadata.height>4096||(metadata.pages??1)!==1)return null;
  const normalized=await image.autoOrient().resize({width:1024,height:1024,fit:"inside",withoutEnlargement:true}).toColourspace("srgb").png({compressionLevel:6}).timeout({seconds:5}).toBuffer();
  if(normalized.length>1_000_000)return null;
  return "data:image/png;base64,"+normalized.toString("base64");
 }catch{return null;}
}
/** LAB: structured configuration only; never accept SVG markup or remote image URLs. */
export async function renderConfiguredLabVisual(input:unknown,masters:Masters):Promise<string|null>{
 if(!exact(input,["data","template","view","palette","lang","defaultBoard"]))return null;
 const {data,template,view,palette,lang,defaultBoard}=input;
 if(!exact(data,["name","activity","phone","slogan","logo"])||!text(data.name,240)||!data.name.trim()||nameNeedsAdaptation(data.name)||!text(data.activity,80)||!text(data.phone,40)||!text(data.slogan,100) )return null;
 const logo=data.logo===null?null:await normalizeLogo(data.logo);
 if(data.logo!==null&&!logo)return null;
 if((template!==1&&template!==2&&template!==3&&template!==4)||(view!=="plat"&&view!=="jour"&&view!=="nuit")||(lang!=="fr"&&lang!=="ar")||typeof defaultBoard!=="boolean")return null;
 if(!exact(palette,["board","night","lettering","accent"])||!color(palette.board)||!color(palette.night)||!color(palette.lettering)||!color(palette.accent))return null;
 const masterHref=view==="plat"?undefined:masters[view];
 if(view!=="plat"&&(!masterHref||!/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/.test(masterHref)))return null;
 const svg=renderToStaticMarkup(createElement(Sign,{data:{name:data.name,activity:data.activity,phone:data.phone,slogan:data.slogan,logo},template,view,palette:{board:palette.board,night:palette.night,lettering:palette.lettering,accent:palette.accent},lang,defaultBoard,masterHref}));
 if(!svg.startsWith("<svg ")||!svg.endsWith("</svg>"))return null;
 return svg.replace("<svg ",'<svg xmlns="http://www.w3.org/2000/svg" ');
}
