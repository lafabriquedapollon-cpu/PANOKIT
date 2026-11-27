import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {Sign,nameNeedsAdaptation,type Document,type Template,type View,type SignColors,type StudioLanguage} from "../../app/studio/studio-renderer";

export type StudioVisualConfig={data:Document;template:Template;view:View;palette:SignColors;lang:StudioLanguage;defaultBoard:boolean};
type Masters=Readonly<{jour:string;nuit:string}>;
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},"value"));
const text=(v:unknown,max:number):v is string=>typeof v==="string"&&v.length<=max&&!/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(v);
const color=(v:unknown):v is string=>typeof v==="string"&&/^#[0-9a-fA-F]{6}$/.test(v);
/** LAB: input is a structured configuration, never XML, HTML, href or an arbitrary file.
 * Logo-bearing configs are deliberately not admitted until the server image pipeline is qualified. */
export function renderConfiguredLabVisual(input:unknown,masters:Masters):string|null{
 if(!exact(input,["data","template","view","palette","lang","defaultBoard"]))return null;
 const {data,template,view,palette,lang,defaultBoard}=input;
 if(!exact(data,["name","activity","phone","slogan","logo"])||!text(data.name,240)||!data.name.trim()||nameNeedsAdaptation(data.name)||!text(data.activity,80)||!text(data.phone,40)||!text(data.slogan,100)||data.logo!==null)return null;
 if((template!==1&&template!==2&&template!==3&&template!==4)||(view!=="plat"&&view!=="jour"&&view!=="nuit")||(lang!=="fr"&&lang!=="ar")||typeof defaultBoard!=="boolean")return null;
 if(!exact(palette,["board","night","lettering","accent"])||!color(palette.board)||!color(palette.night)||!color(palette.lettering)||!color(palette.accent))return null;
 const masterHref=view==="plat"?undefined:masters[view];
 if(view!=="plat"&&(!masterHref||!/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/.test(masterHref)))return null;
 const svg=renderToStaticMarkup(createElement(Sign,{data:{name:data.name,activity:data.activity,phone:data.phone,slogan:data.slogan,logo:null},template,view,palette:{board:palette.board,night:palette.night,lettering:palette.lettering,accent:palette.accent},lang,defaultBoard,masterHref}));
 if(!svg.startsWith("<svg ")||!svg.endsWith("</svg>"))return null;
 return svg.replace("<svg ",'<svg xmlns="http://www.w3.org/2000/svg" ');
}
