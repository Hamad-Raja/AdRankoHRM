import {teamMatchesCampaign,retainEligibleTeam} from './management-utils';
import { useState } from 'react';
import { ActionForm, Field } from './management-widgets';
import { assignEmployee } from '@/services/organization.service';
export default function OrganizationAssignmentEditor({employeeId,current,data,onSaved,onBusyChange}){
 const [selected,setSelected]=useState(()=>({departmentId:current?.departmentId||'',campaignId:current?.campaignId||'',teamId:current?.teamId||'',designationId:current?.designationId||'',reportingManagerId:current?.reportingManagerId||''}));
 const units=data?.units||[];
 const active=unit=>!unit.archivedAt&&(!unit.departmentId||!units.find(parent=>parent.id===unit.departmentId)?.archivedAt)&&(!unit.campaignId||!units.find(parent=>parent.id===unit.campaignId)?.archivedAt);
 const choices=(kind,predicate=()=>true)=>[['','Not assigned'],...units.filter(unit=>unit.kind===kind&&active(unit)&&predicate(unit)).map(unit=>[unit.id,unit.name])];
 function change(event){const {name,value}=event.target;setSelected(old=>{const next={...old,[name]:value};return name==='departmentId'||name==='campaignId'?retainEligibleTeam(next,units,active):next;});}
 return <ActionForm title="Change organization assignment" submit="Save organization assignment" onSaved={onSaved} onBusyChange={onBusyChange} action={(form,options)=>assignEmployee(employeeId,{...selected,campaignId:selected.campaignId||null,teamId:selected.teamId||null,reportingManagerId:selected.reportingManagerId||null,effectiveFrom:form.get('effectiveFrom'),effectiveTo:form.get('effectiveTo')||null,reason:form.get('reason')},options)}>
  <Field label="Department" name="departmentId" value={selected.departmentId} onChange={change} required options={choices('DEPARTMENT')}/>
  <Field label="Campaign (Optional)" name="campaignId" value={selected.campaignId} onChange={change} options={choices('CAMPAIGN',unit=>!unit.departmentId||unit.departmentId===selected.departmentId)}/>
  <Field label="Team (Optional)" name="teamId" value={selected.teamId} onChange={change} options={choices('TEAM',unit=>teamMatchesCampaign(unit,selected.campaignId))}/>
  {selected.departmentId&&choices('TEAM',unit=>teamMatchesCampaign(unit,selected.campaignId)).length===1&&<p className="text-sm text-muted-foreground">{selected.campaignId?'No active teams are available for the selected campaign.':'No active teams are available without a campaign.'}</p>}
  <Field label="Designation (Job Title)" name="designationId" value={selected.designationId} onChange={change} required options={choices('DESIGNATION')}/>
  <Field label="Reporting Manager (Optional)" name="reportingManagerId" value={selected.reportingManagerId} onChange={change} options={ [['','No reporting manager'],...(data?.eligibleManagers||[]).map(manager=>[manager.id,[manager.employee?.fullName||manager.displayName,manager.employee?.employeeCode].filter(Boolean).join(' — ')])] }/>
  <Field label="Effective From" name="effectiveFrom" type="date" required/><Field label="Effective To (Optional)" name="effectiveTo" type="date"/><Field label="Assignment change reason" name="reason" required maxLength={1000}/>
  <p className="text-sm text-muted-foreground sm:col-span-2">Current values are loaded above. A replacement must start after {current?.effectiveFrom?.slice(0,10)||'the preceding open assignment'}. Prior dated assignments remain in history.</p>
 </ActionForm>;
}
