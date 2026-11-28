import type {createBatLabAdapter} from "./bat-pg-lab";

type Adapter=Pick<ReturnType<typeof createBatLabAdapter>,"sendOtp"|"confirm"|"refuse">;
type Binding=Readonly<{caseId:string;version:number;linkToken:string;sourceSession:string;expectedDigest:string}>;
type Decision="otp-sent"|"approved"|"wrong"|"locked"|"refused";
type Outcome={status:"ok";value:{scope:"LAB";manufacturable:false;version:number;result:Decision}}|{status:"unavailable"};
const fail=():Outcome=>({status:"unavailable"});
const hex=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
function exact(v:unknown,keys:readonly string[]):v is Record<string,unknown>{
 if(!v||typeof v!=="object"||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return false;
 return Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},"value"));
}
const locale=(v:unknown):v is "fr"|"ar"=>v==="fr"||v==="ar";
/** Server-local LAB decision session. Trusted broker must bind this to exactly
 * one cookie, verified fixture preview and its lifecycle. Never expose the
 * constructor or markPreview to browser input. SQL remains authoritative.
 * A revoked/expired session or lost acknowledgement cannot undo a committed
 * transaction; return unavailable and never automatically retry. */
export function createBatDecisionSession(adapter:Adapter,binding:Binding,isLive:()=>boolean){
 if(!uuid(binding.caseId)||!Number.isSafeInteger(binding.version)||binding.version<1||!hex(binding.linkToken)||!hex(binding.sourceSession)||!hex(binding.expectedDigest))throw Error("LAB_BINDING");
 const version=binding.version,sourceSession=binding.sourceSession,digest=binding.expectedDigest;
 const context=Object.freeze({caseId:binding.caseId,version,linkToken:binding.linkToken,digest});
 let preview=false,busy=false,terminal=false,challenge:string|undefined;
 const ok=(result:Decision):Outcome=>({status:"ok",value:{scope:"LAB",manufacturable:false,version,result}});
 return {
  // A server-verified PNG was offered; this is NOT proof of human viewing.
  markPreview(sourceDigest:string){if(isLive()&&!terminal&&sourceDigest===digest)preview=true;},
  async execute(input:unknown):Promise<Outcome>{
   if(!isLive()||!preview||busy||terminal)return fail();
   const request=exact(input,["action"])&&input.action==="request-otp";
   const confirm=exact(input,["action","explicit","locale","code"])&&input.action==="confirm"&&input.explicit===true&&locale(input.locale)&&typeof input.code==="string"&&/^[0-9]{6}$/.test(input.code);
   const refuse=exact(input,["action","explicit","locale"])&&input.action==="refuse"&&input.explicit===true&&locale(input.locale);
   if((!request&&!confirm&&!refuse)||(request&&challenge)||(confirm&&!challenge))return fail();
   const data=input as Record<string,unknown>;
   busy=true;
   try{
    if(request){
     const r=await adapter.sendOtp(context,sourceSession);
     if(!isLive()||r.status!=="ok"||!uuid(r.value.challengeId)){terminal=true;challenge=undefined;return fail();}
     challenge=r.value.challengeId;return ok("otp-sent");
    }
    if(confirm&&challenge){
     const r=await adapter.confirm({...context,challengeId:challenge,code:data.code,statement:"lab-bat-v1",locale:data.locale},sourceSession);
     if(!isLive()||r.status!=="ok"||!["approved","wrong","locked"].includes(r.value)){terminal=true;challenge=undefined;return fail();}
     if(r.value!=="wrong"){terminal=true;challenge=undefined;}
     return ok(r.value);
    }
    if(refuse){
     const r=await adapter.refuse({...context,explicit:true,locale:data.locale},sourceSession);
     terminal=true;challenge=undefined;
     return isLive()&&r.status==="ok"&&r.value===true?ok("refused"):fail();
    }
    return fail();
   }catch{terminal=true;challenge=undefined;return fail();}
   finally{busy=false;}
  }
 };
}
