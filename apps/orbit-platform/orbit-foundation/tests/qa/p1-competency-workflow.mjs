import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const supabaseStatus = process.platform === "win32"
  ? execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npx supabase status --workdir orbit-foundation -o env"], { encoding: "utf8" })
  : execFileSync("npx", ["supabase", "status", "--workdir", "orbit-foundation", "-o", "env"], { encoding: "utf8" });
const env = Object.fromEntries(supabaseStatus
  .split(/\r?\n/).filter(Boolean).map((line) => { const at=line.indexOf("="); return [line.slice(0,at),line.slice(at+1).replace(/^"|"$/g,"")]; }));
const api=env.API_URL, anon=env.ANON_KEY, service=env.SERVICE_ROLE_KEY;
if(!api||!anon||!service) throw new Error("Local Foundation Supabase is unavailable.");
async function request(path,{token=service,...options}={}) {
  const response=await fetch(`${api}${path}`,{...options,headers:{apikey:token===service?service:anon,Authorization:`Bearer ${token}`,"Content-Type":"application/json",...(options.headers||{})}});
  const body=await response.json().catch(()=>null); return {status:response.status,body};
}
async function admin(table,body,query="") {
  const result=await request(`/rest/v1/${table}${query}`,{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(body)});
  assert.equal(result.status,201,`${table}: ${JSON.stringify(result.body)}`); return result.body;
}
async function patch(table,query,body) {
  const result=await request(`/rest/v1/${table}?${query}`,{method:"PATCH",body:JSON.stringify(body)}); assert.equal(result.status,204,JSON.stringify(result.body));
}
async function user(label) {
  const email=`p1-${label}-${Date.now()}@example.test`, password="Orbit-p1-test-2026!";
  const created=await request("/auth/v1/admin/users",{method:"POST",body:JSON.stringify({email,password,email_confirm:true})}); assert.equal(created.status,200);
  const signed=await request("/auth/v1/token?grant_type=password",{token:anon,method:"POST",body:JSON.stringify({email,password})}); assert.equal(signed.status,200);
  return {id:created.body.id,token:signed.body.access_token,email};
}
async function workspace(token,action,payload={}) { return request("/rest/v1/rpc/competency_workspace",{token,method:"POST",body:JSON.stringify({action,payload})}); }

const [owner,learner,outsider]=await Promise.all([user("owner"),user("learner"),user("outsider")]);
const [org,otherOrg]=await admin("foundation_organizations",[{name:"P1 QA",slug:`p1-${Date.now()}`},{name:"Other QA",slug:`p1-other-${Date.now()}`}]);
await admin("organization_memberships",[
  {organization_id:org.id,user_id:owner.id,org_role:"org_admin",status:"active"},
  {organization_id:org.id,user_id:learner.id,org_role:"employee",status:"active"},
  {organization_id:otherOrg.id,user_id:outsider.id,org_role:"employee",status:"active"},
]);
await admin("user_active_organizations",[
  {user_id:owner.id,organization_id:org.id},{user_id:learner.id,organization_id:org.id},{user_id:outsider.id,organization_id:otherOrg.id},
]);
await admin("organization_product_entitlements",[
  {organization_id:org.id,product_key:"competencies",status:"active"},{organization_id:org.id,product_key:"feedback",status:"active"},
  {organization_id:otherOrg.id,product_key:"competencies",status:"active"},
]);
await admin("product_role_assignments",[
  {organization_id:org.id,user_id:owner.id,product_key:"competencies",role_key:"competency_admin",granted_by:owner.id},
  {organization_id:org.id,user_id:owner.id,product_key:"feedback",role_key:"feedback_admin",granted_by:owner.id},
  {organization_id:org.id,user_id:learner.id,product_key:"competencies",role_key:"employee",granted_by:owner.id},
  {organization_id:otherOrg.id,user_id:outsider.id,product_key:"competencies",role_key:"employee",granted_by:outsider.id},
]);

const denied=await workspace(outsider.token,"save_framework",{libraryKey:"other",name:"Other",definitions:[]});
assert.equal(denied.status,403,"ordinary employee must not administer frameworks");
const definitions=[{code:"active_listening",name:"Active listening",category:"core",definition:"Attend, clarify and confirm understanding before responding.",levels:["Listens with guidance.","Checks understanding independently.","Clarifies competing views.","Coaches others to listen."]}];
const saved=await workspace(owner.token,"save_framework",{libraryKey:"core",name:"Core skills",definitions}); assert.equal(saved.status,200,JSON.stringify(saved.body));
const frameworkId=saved.body.id;
assert.equal((await workspace(owner.token,"publish_framework",{id:frameworkId})).status,200);
assert.equal((await workspace(owner.token,"save_framework",{id:frameworkId,libraryKey:"core",name:"Changed",definitions})).status,400,"published versions must be immutable");

const [subject,...reviewers]=await admin("organization_people",[
  {organization_id:org.id,linked_user_id:learner.id,full_name:"Learner",work_email:learner.email,imported_by:owner.id},
  ...[1,2,3].map(i=>({organization_id:org.id,linked_user_id:null,full_name:`Reviewer ${i}`,work_email:`p1-reviewer-${i}-${Date.now()}@example.test`,imported_by:owner.id})),
]);
const [cycle]=await admin("feedback_cycles",{organization_id:org.id,name:"Development 360",purpose:"development",status:"draft",anonymous_group_threshold:3,created_by:owner.id});
const [question]=await admin("feedback_cycle_questions",{organization_id:org.id,cycle_id:cycle.id,competency_label:"Active listening",question_type:"rating",prompt:"Listens and checks understanding.",scale_definition:{min:1,max:5},sort_order:1});
let mapped=await workspace(owner.token,"map_question",{frameworkId,competencyCode:"active_listening",targetLevel:3,questionId:question.id,thresholds:[1,2,3,4]}); assert.equal(mapped.status,200,JSON.stringify(mapped.body));
const [roster]=await admin("feedback_cycle_roster_subjects",{organization_id:org.id,cycle_id:cycle.id,subject_person_id:subject.id,created_by:owner.id});
const raters=await admin("feedback_cycle_roster_raters",reviewers.map(person=>({organization_id:org.id,cycle_id:cycle.id,subject_roster_id:roster.id,reviewer_person_id:person.id,rater_group:"peer",status:"submitted",nominated_by:owner.id,reviewed_by:owner.id})));
const deliveries=await admin("feedback_invitation_deliveries",raters.map((rater,i)=>({organization_id:org.id,cycle_id:cycle.id,roster_rater_id:rater.id,recipient_email:reviewers[i].work_email,token_hash:`p1-token-${Date.now()}-${i}`,status:"completed",completed_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),created_by:owner.id})));
await admin("feedback_invitation_responses",deliveries.map((delivery,i)=>({organization_id:org.id,cycle_id:cycle.id,delivery_id:delivery.id,cycle_question_id:question.id,rating:i<2?2:3})));
await patch("feedback_cycles",`id=eq.${cycle.id}`,{status:"closed"});
assert.equal((await workspace(learner.token,"consent",{enabled:true})).status,200);
let read=await workspace(learner.token,"read"); assert.equal(read.status,200,JSON.stringify(read.body)); assert.deepEqual(read.body.signals,[],"unreleased report must not create a signal");
await admin("feedback_directory_report_releases",{organization_id:org.id,cycle_id:cycle.id,roster_subject_id:roster.id,status:"released",released_by:owner.id});
read=await workspace(learner.token,"read"); assert.equal(read.body.signals.length,1,"three anonymous respondents must pass the threshold");
assert.equal(read.body.signals[0].competencyCode,"active_listening");
assert.equal(read.body.signals[0].observedLevel,2);
assert.equal(JSON.stringify(read.body).includes("recipient_email"),false);
assert.equal(JSON.stringify(read.body).includes('"rating":'),false);
assert.deepEqual((await workspace(outsider.token,"read")).body.signals,[],"another tenant must not see this signal");
assert.equal((await workspace(learner.token,"consent",{enabled:false})).status,200);
assert.deepEqual((await workspace(learner.token,"read")).body.signals,[],"withdrawal must stop processing");
console.log("P1 competency workflow passed: role gate, immutable version, release gate, anonymity, tenant isolation and consent withdrawal.");
