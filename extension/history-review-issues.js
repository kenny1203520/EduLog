/** Recognizable, actionable local validation feedback; never changes decisions. */
export function renderReviewBlockers(host,issues,items,hooks){
  if(!issues?.length)return
  const doc=host.ownerDocument,ui=globalThis.edulogUi
  const make=(tag,text)=>{const element=doc.createElement(tag);if(text!==undefined)element.textContent=text;return element}
  const text=(element,key,params)=>ui?ui.text(element,key,params):element.textContent=key
  const section=make('section');section.className='notice warning review-blockers';section.dataset.reviewBlockers='';section.setAttribute('aria-live','polite')
  const reports=[...new Map(issues.map(issue=>[issue.source_id,issue])).values()]
  const heading=make('h3');text(heading,'work.reviewBlockerCount',{count:reports.length});section.append(heading)
  for(const issue of reports){
    const item=items.find(candidate=>candidate.key===issue.source_id),record=item?.record||hooks.record?.(issue.source_id),card=make('section')
    card.className='stale-review-card';card.dataset.reviewBlockerKey=issue.source_id
    const title=make('h4'),student=record?.sourceStudentName||item?.target?.name
    if(student)title.textContent=student;else text(title,'work.reviewStudentMissing')
    const meta=make('p'),course=make('span'),date=make('span'),courseName=record?.sourceCourseLabel||item?.target?.courseName,dateValue=record?.date||record?.dateRaw
    if(courseName)course.textContent=courseName;else text(course,'work.reviewCourseMissing')
    if(dateValue)date.textContent=dateValue;else text(date,'work.reviewDateMissing')
    meta.append(course,doc.createTextNode(' · '),date)
    card.append(title,meta)
    if(record?.sourceStudentName&&item?.target?.name&&record.sourceStudentName!==item.target.name)card.append(make('p',`EduLog：${item.target.name}`))
    const reason=make('p');if(item?.category==='needs'&&item.reason)reason.textContent=item.reason;else text(reason,`work.reviewReason.${['batch-missing','report-missing','linked-unverified'].includes(issue.reason)?issue.reason:'unresolved'}`);card.append(reason)
    const open=make('button');open.type='button';open.dataset.reviewBlockerOpen='';text(open,'work.staleOpen');open.disabled=!item
    open.onclick=()=>hooks.open(issue.source_id,issue.targets?.[0]?.field)
    const retry=make('button');retry.type='button';text(retry,'work.reviewRecheckReport');retry.onclick=()=>hooks.recheck(issue.source_id,record?.enrollment_source_id)
    card.append(open,retry)
    if(record?.enrollment_source_id){const link=make('a');text(link,'work.reviewOpenSource');link.href=`https://corp.orangeapple.co/dt_admissions/${encodeURIComponent(record.enrollment_source_id)}`;link.target='_blank';link.rel='noopener noreferrer';card.append(link)}
    const detail=make('details'),summary=make('summary');text(summary,'work.staleEvidence');detail.append(summary,make('p',`${issue.source_id} · ${issue.batchKey||''}`));card.append(detail);section.append(card)
  }
  host.append(section)
}
