// The Settings load ladder may choose an organization without writing a device
// preference. Observe the controlled Select's checked option, not storage alone.
export function approvedOrganizationStateExpression(approved) {
  return `(async () => {
    const rows=[...document.querySelectorAll('span')]
      .filter(span=>span.textContent.trim()==='Acting as');
    const controls=rows.flatMap(row=>[...row.parentElement.parentElement.querySelectorAll(
      'button[role="combobox"]')]);
    const options=[...document.querySelectorAll('[role="option"]')];
    const approvedOptions=options.filter(option=>option.textContent.trim()===${JSON.stringify(approved)});
    const approvedId=approvedOptions.length===1?approvedOptions[0].getAttribute('data-value'):null;
    const identityPresent=typeof approvedId==='string'&&approvedId.length>0;
    const checked=options.filter(option=>option.getAttribute('data-state')==='checked');
    const stored=(await chrome.storage.local.get('matrx.org.active'))['matrx.org.active'];
    return {count:controls.length,displayed:controls.length===1&&controls[0].textContent.trim()===
      ${JSON.stringify(approved)},approvedOptionCount:approvedOptions.length,
      checkedOptionCount:checked.length,
      approvedCheckedCount:approvedOptions.filter(option=>option.getAttribute('data-state')==='checked').length,
      identityPresent,storageAbsent:stored===undefined||stored===null,
      stored:stored?.name===${JSON.stringify(approved)}&&identityPresent&&stored?.id===approvedId};
  })()`;
}

export function approvedOrganizationSelectionMatches(state, alreadyActive) {
  return (
    state?.count === 1 &&
    state.identityPresent === true &&
    state.displayed === true &&
    state.approvedOptionCount === 1 &&
    state.checkedOptionCount === 1 &&
    state.approvedCheckedCount === 1 &&
    (state.stored === true || (alreadyActive === true && state.storageAbsent === true))
  );
}
