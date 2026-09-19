import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const output=process.platform==="win32"
  ? execFileSync(process.env.ComSpec??"cmd.exe",["/d","/s","/c","npx supabase status --workdir orbit-foundation -o env"],{encoding:"utf8"})
  : execFileSync("npx",["supabase","status","--workdir","orbit-foundation","-o","env"],{encoding:"utf8"});
const env=Object.fromEntries(output.split(/\r?\n/).filter(Boolean).map(line=>{const at=line.indexOf("=");return [line.slice(0,at),line.slice(at+1).replace(/^"|"$/g,"")];}));
const api=env.API_URL,anon=env.ANON_KEY,service=env.SERVICE_ROLE_KEY;
if(!api||!anon||!service) throw new Error("Local Foundation Supabase is unavailable.");
async function request(path,{token=service,...options}={}){const response=await fetch(`${api}${path}`,{...options,headers:{apikey:token===service?service:anon,Authorization:`Bearer ${token}`,"Content-Type":"application/json",...(options.headers||{})}});return {status:response.status,body:await response.json().catch(()=>null)};}
async function admin(table,body){const result=await request(`/rest/v1/${table}`,{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(body)});assert.equal(result.status,201,`${table}: ${JSON.stringify(result.body)}`);return result.body;}
async function patch(table,query,body){const result=await request(`/rest/v1/${table}?${query}`,{method:"PATCH",body:JSON.stringify(body)});assert.equal(result.status,204,JSON.stringify(result.body));}
async function user(label){const email=`p2-${label}-${Date.now()}@example.test`,password="Orbit-p2-test-2026!";const created=await request("/auth/v1/admin/users",{method:"POST",body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);const signed=await request("/auth/v1/token?grant_type=password",{token:anon,method:"POST",body:JSON.stringify({email,password})});assert.equal(signed.status,200);return {id:created.body.id,token:signed.body.access_token,email};}
const rpc=(token,name,action,payload={})=>request(`/rest/v1/rpc/${name}`,{token,method:"POST",body:JSON.stringify({action,payload})});

const [owner,manager,...subjects]=await Promise.all([user("owner"),user("manager"),user("subject1"),user("subject2"),user("subject3")]);
const outsider=await user("outsider");
const [org,otherOrg]=await admin("foundation_organizations",[{name:"P2 QA",slug:`p2-${Date.now()}`},{name:"Other P2",slug:`p2-other-${Date.now()}`}]);
const members=[owner,manager,...subjects];
await admin("organization_memberships",[...members.map((person,index)=>({organization_id:org.id,user_id:person.id,org_role:index===0?"org_admin":"employee",status:"active"})),{organization_id:otherOrg.id,user_id:outsider.id,org_role:"employee",status:"active"}]);
await admin("user_active_organizations",[...members.map(person=>({user_id:person.id,organization_id:org.id})),{user_id:outsider.id,organization_id:otherOrg.id}]);
await admin("organization_product_entitlements",[{organization_id:org.id,product_key:"competencies",status:"active"},{organization_id:org.id,product_key:"feedback",status:"active"},{organization_id:otherOrg.id,product_key:"competencies",status:"active"}]);
await admin("product_role_assignments",[
  {organization_id:org.id,user_id:owner.id,product_key:"competencies",role_key:"competency_admin",granted_by:owner.id},
  {organization_id:org.id,user_id:owner.id,product_key:"feedback",role_key:"feedback_admin",granted_by:owner.id},
  ...[manager,...subjects].map(person=>({organization_id:org.id,user_id:person.id,product_key:"competencies",role_key:"employee",granted_by:owner.id})),
  {organization_id:otherOrg.id,user_id:outsider.id,product_key:"competencies",role_key:"employee",granted_by:outsider.id},
]);

let p2=await rpc(owner.token,"competency_p2_workspace","read");assert.equal(p2.status,200,JSON.stringify(p2.body));assert.equal(p2.body.packs.length,3,"exactly three pilot role-family packs ship in P2-A");
const pack=p2.body.packs.find(item=>item.packKey==="people_manager");assert.ok(pack);assert.equal(pack.definitions.length,4,"pack preview exposes its attributed definitions");assert.equal((await rpc(manager.token,"competency_p2_workspace","activate_pack",{id:pack.id})).status,403,"employees cannot activate packs");
const activated=await rpc(owner.token,"competency_p2_workspace","activate_pack",{id:pack.id});assert.equal(activated.status,200,JSON.stringify(activated.body));
assert.equal((await rpc(owner.token,"competency_p2_workspace","activate_pack",{id:pack.id})).status,400,"a pack version activates once per organisation");
assert.equal((await rpc(owner.token,"competency_workspace","publish_framework",{id:activated.body.frameworkId})).status,200);

const people=await admin("organization_people",[
  {organization_id:org.id,linked_user_id:manager.id,full_name:"Manager",work_email:manager.email,imported_by:owner.id},
  ...subjects.map((person,index)=>({organization_id:org.id,linked_user_id:person.id,full_name:`Subject ${index+1}`,work_email:person.email,imported_by:owner.id})),
  ...[1,2,3].map(index=>({organization_id:org.id,linked_user_id:null,full_name:`Reviewer ${index}`,work_email:`p2-reviewer-${index}-${Date.now()}@example.test`,imported_by:owner.id})),
]);
const managerPerson=people[0],subjectPeople=people.slice(1,4),reviewers=people.slice(4);
const [cycle]=await admin("feedback_cycles",{organization_id:org.id,name:"P2 Team 360",purpose:"development",status:"draft",anonymous_group_threshold:3,created_by:owner.id});
const [question]=await admin("feedback_cycle_questions",{organization_id:org.id,cycle_id:cycle.id,competency_label:"Active listening",question_type:"rating",prompt:"Listens and checks understanding.",scale_definition:{min:1,max:5},sort_order:1});
assert.equal((await rpc(owner.token,"competency_workspace","map_question",{frameworkId:activated.body.frameworkId,competencyCode:"active_listening",targetLevel:3,questionId:question.id,thresholds:[1,2,3,4]})).status,200);
const rosters=await admin("feedback_cycle_roster_subjects",subjectPeople.map(person=>({organization_id:org.id,cycle_id:cycle.id,subject_person_id:person.id,manager_person_id:managerPerson.id,created_by:owner.id})));
for(let subjectIndex=0;subjectIndex<rosters.length;subjectIndex++){
  const raters=await admin("feedback_cycle_roster_raters",reviewers.map(person=>({organization_id:org.id,cycle_id:cycle.id,subject_roster_id:rosters[subjectIndex].id,reviewer_person_id:person.id,rater_group:"peer",status:"submitted",nominated_by:owner.id,reviewed_by:owner.id})));
  const deliveries=await admin("feedback_invitation_deliveries",raters.map((rater,index)=>({organization_id:org.id,cycle_id:cycle.id,roster_rater_id:rater.id,recipient_email:reviewers[index].work_email,token_hash:`p2-${subjectIndex}-${index}-${Date.now()}`,status:"completed",completed_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),created_by:owner.id})));
  await admin("feedback_invitation_responses",deliveries.map((delivery,index)=>({organization_id:org.id,cycle_id:cycle.id,delivery_id:delivery.id,cycle_question_id:question.id,rating:index<2?2:3})));
  assert.equal((await rpc(subjects[subjectIndex].token,"competency_workspace","consent",{enabled:true})).status,200);
}
p2=await rpc(manager.token,"competency_p2_workspace","read");assert.deepEqual(p2.body.teamSignals,[],"personal recommendation consent alone never enables manager reporting");
for(const subject of subjects) assert.equal((await rpc(subject.token,"competency_p2_workspace","manager_consent",{enabled:true})).status,200);
for(const roster of rosters) await admin("feedback_directory_report_releases",{organization_id:org.id,cycle_id:cycle.id,roster_subject_id:roster.id,status:"released",released_by:owner.id});
await patch("feedback_cycles",`id=eq.${cycle.id}`,{status:"closed"});
p2=await rpc(manager.token,"competency_p2_workspace","read");assert.equal(p2.status,200,JSON.stringify(p2.body));assert.equal(p2.body.managerAccess,true);assert.equal(p2.body.directReportCount,3);assert.equal(p2.body.teamSignals.length,1);assert.equal(p2.body.teamSignals[0].memberCount,3);
assert.equal(JSON.stringify(p2.body).includes("recipient_email"),false);assert.equal(JSON.stringify(p2.body).includes('"rating":'),false);assert.equal(JSON.stringify(p2.body).includes("linked_user_id"),false);
const other=await rpc(outsider.token,"competency_p2_workspace","read");assert.equal(other.body.managerAccess,false);assert.deepEqual(other.body.teamSignals,[]);
assert.equal((await rpc(outsider.token,"competency_p2_workspace","read",{cycleId:cycle.id})).status,403,"a manager cannot select another organisation's cycle");
const privacy=await rpc(subjects[0].token,"competency_p2_workspace","privacy");assert.equal(privacy.body.managerConsented,true);assert.equal(JSON.stringify(privacy.body).includes("teamSignals"),false);
assert.equal((await rpc(subjects[0].token,"competency_workspace","consent",{enabled:false})).status,200);
assert.equal((await rpc(subjects[0].token,"competency_p2_workspace","privacy")).body.managerConsented,false,"withdrawing personal consent resets manager consent");
p2=await rpc(manager.token,"competency_p2_workspace","read");assert.deepEqual(p2.body.teamSignals,[],"fewer than three consenting people suppresses the aggregate");
console.log("P2 competency workflow passed: pack preview/activation, admin gate, separate consent, manager scope, anonymity, filters and tenant isolation.");
