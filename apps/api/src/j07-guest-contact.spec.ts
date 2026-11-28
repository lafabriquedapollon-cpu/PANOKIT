import assert from "node:assert/strict";
import {test} from "node:test";
import {validateGuestContact} from "./j07/guest-contact";

const pickup = {name:"Client Test",phone:"06 00 00 00 00"};
const delivery = {...pickup,city:"Ville Test",address:"12, rue Exemple"};
test("J07 contact minimal pickup and canonical phone",()=>{
  assert.deepEqual(validateGuestContact(pickup,"pickup"),{status:"valid",contact:{name:"Client Test",phone:"+212600000000"}});
});
test("J07 Arabic and Arabic-Indic phone",()=>{
  assert.deepEqual(validateGuestContact({name:"عميل تجريبي",phone:"٠٦٠٠٠٠٠٠٠٠"},"pickup"),
    {status:"valid",contact:{name:"عميل تجريبي",phone:"+212600000000"}});
});
test("J07 Persian digits and international prefix",()=>{
  assert.deepEqual(validateGuestContact({name:"Client Test",phone:"۰۰۲۱۲۶۰۰۰۰۰۰۰۰"},"pickup"),
    {status:"valid",contact:{name:"Client Test",phone:"+212600000000"}});
});
test("J07 optional email omitted and normalized domain only",()=>{
  assert.deepEqual(validateGuestContact({...pickup,email:""},"pickup"),validateGuestContact(pickup,"pickup"));
  assert.deepEqual(validateGuestContact({...pickup,email:"Fixture@EXAMPLE.INVALID"},"pickup"),
    {status:"valid",contact:{name:"Client Test",phone:"+212600000000",email:"Fixture@example.invalid"}});
});
test("J07 delivery needs both fields and returns nested address",()=>{
  assert.deepEqual(validateGuestContact(delivery,"delivery"),{status:"valid",contact:{name:"Client Test",phone:"+212600000000",delivery:{city:"Ville Test",address:"12, rue Exemple"}}});
  assert.deepEqual(validateGuestContact(pickup,"delivery"),{status:"invalid",reason:"invalid_fields",fields:["city","address"]});
});
test("J07 no delivery PII allowed in pickup",()=>{
  assert.equal(validateGuestContact(delivery,"pickup").status,"invalid");
  assert.equal(validateGuestContact({...pickup,address:""},"pickup").status,"invalid");
});
test("J07 missing contact fields return field IDs only",()=>{
  assert.deepEqual(validateGuestContact({},"pickup"),{status:"invalid",reason:"invalid_fields",fields:["name","phone"]});
});
test("J07 refuse browser authority or marketing injection",()=>{
  for(const extra of [{price:1},{mode:"delivery"},{role:"admin"},{orderable:true},{consent:true},{leaseToken:"test"}]){
    assert.deepEqual(validateGuestContact({...pickup,...extra},"pickup"),{status:"invalid",reason:"invalid_shape",fields:[]});
  }
});
test("J07 reject malformed data and custom prototypes",()=>{
  for(const x of [null,[],true,"test",Object.create(pickup),JSON.parse('{"name":"Test","phone":"0600000000","__proto__":{}}')]){
    assert.equal(validateGuestContact(x,"pickup").status,"invalid");
  }
});
test("J07 refuse contact getters without invoking",()=>{
  const x={...pickup};Object.defineProperty(x,"email",{get(){throw Error("must not invoke");}});
  assert.equal(validateGuestContact(x,"pickup").status,"invalid");
});
test("J07 invalid telephone and email do not echo input",()=>{
  assert.deepEqual(validateGuestContact({...pickup,phone:"abc",email:"a..b@example.invalid"},"pickup"),
    {status:"invalid",reason:"invalid_fields",fields:["phone","email"]});
});
test("J07 control characters, bidi overrides and oversized inputs refused",()=>{
  assert.deepEqual(validateGuestContact({...pickup,name:"Test\u202e",phone:"06\n00000000",email:"a@"+"x".repeat(255)},"pickup"),
    {status:"invalid",reason:"invalid_fields",fields:["name","phone","email"]});
  assert.equal(validateGuestContact({...delivery,address:"x".repeat(301)},"delivery").status,"invalid");
});
test("J07 trimming and Unicode normalization do not alter original",()=>{
  const input={...pickup,name:"  Cafe\u0301   Test  "};
  const result=validateGuestContact(input,"pickup");
  assert.equal(result.status,"valid");
  if(result.status==="valid") assert.equal(result.contact.name,"Café Test");
  assert.equal(input.name,"  Cafe\u0301   Test  ");
});
