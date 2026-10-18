(() => {
  const ui=globalThis.edulogUi
  const text=(el,key,fallback)=>ui?ui.text(el,key):Object.assign(el,{textContent:fallback})
  const styles=`.edulog-integration{font:inherit;color:inherit}.edulog-flow{display:grid;gap:6px;padding:12px 0;border-top:1px solid var(--edulog-border-soft)}.edulog-flow-heading{display:flex;align-items:center;gap:12px;justify-content:space-between}.edulog-flow h3{margin:0;font-size:var(--edulog-text-md,14px);font-weight:600;color:var(--edulog-text-strong)}.edulog-flow-state{font-size:var(--edulog-text-xs,12px);font-weight:500;padding:2px 8px;border-radius:999px;background:var(--edulog-surface-muted);color:var(--edulog-text-secondary)}.edulog-flow p{font-size:var(--edulog-text-sm,13px);line-height:1.5;margin:0;color:var(--edulog-text-muted)}.edulog-flow button{min-height:var(--edulog-touch-target,44px);width:100%;font:inherit;font-weight:600;padding:0 14px;border:1px solid var(--edulog-border-strong);border-radius:var(--edulog-radius-sm,6px);background:var(--edulog-surface);color:var(--edulog-text);cursor:pointer;transition:background var(--edulog-duration,160ms)}.edulog-flow button:hover{background:var(--edulog-surface-muted)}.edulog-flow summary{min-height:32px;cursor:pointer;color:var(--edulog-primary);font-size:var(--edulog-text-sm,13px);display:flex;align-items:center}.edulog-flow button:focus-visible,.edulog-flow summary:focus-visible{outline:3px solid var(--edulog-focus-ring);outline-offset:2px}.edulog-flow ol{margin:0;padding-left:20px;font-size:var(--edulog-text-sm,13px);color:var(--edulog-text-secondary)}.edulog-flow li{margin:4px 0}`
  globalThis.edulogIntegrationUi=Object.freeze({
    theme:{name:'EduLog 清晰主題',apply:'套用清晰主題',original:'使用原站主題'},
    mount(container){
      const doc=container.ownerDocument,controls=[]
      container.classList.add('edulog-integration');const style=doc.createElement('style');style.textContent=styles;container.append(style)
      for(const id of ['import','prefill']){
        const card=doc.createElement('article');card.className='edulog-flow'
        const heading=doc.createElement('div');heading.className='edulog-flow-heading'
        const title=text(doc.createElement('h3'),`flow.${id}`,id==='import'?'同步教學資料':'預填目前報告'),state=doc.createElement('span');state.className='edulog-flow-state';heading.append(title,state)
        const description=text(doc.createElement('p'),`flow.${id}Help`,id==='import'?'讀取完整歷史，集中核對例外與同步摘要。':'在原站核對欄位，再由您人工送出。')
        const open=text(doc.createElement('button'),`flow.${id}`,title.textContent);open.type='button';open.dataset.flow=id
        const availability=doc.createElement('p');availability.className='edulog-flow-availability';availability.setAttribute('role','status')
        const details=doc.createElement('details'),summary=text(doc.createElement('summary'),'flow.details','操作說明'),list=doc.createElement('ol')
        const steps=id==='import'?['讀取每筆報名全部可讀歷史，可自行縮小日期範圍。','沿用有效對應，只處理身份、日期、教材及覆寫例外。','查看摘要後確認同步；寫入中斷可核對並續傳。']:['在原站開啟報告，核對學生及完整上課日期。','選擇報告並逐欄預覽；非空內容需確認覆寫。','預填後由老師檢查與人工送出。']
        for(const [index,step] of steps.entries()){const li=text(doc.createElement('li'),`flow.${id}Step${index+1}`,step);list.append(li)}details.append(summary,list)
        open.addEventListener('click',async()=>{open.disabled=true;try{const result=await globalThis.edulogRuntime.send({type:'open-integration-workspace',flow:id});if(!result?.opened)throw new Error(result?.error?.message||'無法開啟整合工作台。')}catch(error){availability.textContent=error.message}finally{open.disabled=false}})
        card.append(heading,description,open,availability,details);container.append(card);controls.push({id,state,availability})
      }
      return {update(value){const status=typeof value==='string'?value:value?.status;for(const control of controls){const ready=status==='connected'&&value?.capabilities?.[control.id==='import'?'teaching_data_import':'report_prefill']===true;text(control.state,ready?'flow.ready':status==='connected'?'flow.notReady':'flow.connect',ready?'可開始':status==='connected'?'此操作未就緒':'先完成連線');control.availability.hidden=status!=='connected'||ready;if(!control.availability.hidden)text(control.availability,'flow.unavailable','此連線未提供這項操作，請重新檢查連線或查看診斷。')}}}
    },
  })
})()
