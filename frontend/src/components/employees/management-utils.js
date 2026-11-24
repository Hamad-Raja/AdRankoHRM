export const formObject = form => Object.fromEntries([...form].filter(([, value]) => typeof value === 'string' && value !== ''));
export const dateOnly = value => value ? value.slice(0, 10) : 'Open';

// A team's department is ownership; membership follows the selected campaign.
export const teamMatchesCampaign=(team,campaignId)=>team.kind==='TEAM'&&(team.campaignId||'')===(campaignId||'');
export function retainEligibleTeam(next,units,active){
 const result={...next};
 if(result.campaignId){const campaign=units.find(unit=>unit.id===result.campaignId&&unit.kind==='CAMPAIGN');if(!campaign||!active(campaign)||(campaign.departmentId&&campaign.departmentId!==result.departmentId)){result.campaignId='';result.reportingManagerId='';}}
 if(result.teamId){const team=units.find(unit=>unit.id===result.teamId);if(!team||!active(team)||!teamMatchesCampaign(team,result.campaignId)){result.teamId='';result.reportingManagerId='';}}
 return result;
}
