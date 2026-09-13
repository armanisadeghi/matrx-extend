/**
 * One closure-free page-realm dispatcher for every credential DOM operation.
 * Chrome serializes this function verbatim; runtime helpers intentionally live
 * inside it so injected operations cannot drift apart.
 */
export interface BoundLoginGroup {
  anchor: string;
  username: string | null;
  password: string | null;
  usernameOnly: boolean;
  pageUrl: string;
}
export interface ControlledCredentialField { selector: string; value: string | null; }
export type FormDestinationKind = 'safe_post' | 'react_action' | 'unsafe';
export interface FormDestination { kind: FormDestinationKind; reason?: 'method' | 'url' | 'origin' | 'scheme' | 'override'; }
export interface LoginFormProbe {
  is_top_frame: boolean; origin: string; href: string;
  username_selector: string | null; password_selector: string | null;
  submit_selector: string | null; destination_safe: boolean;
}
export interface SpecProbe {
  is_top_frame: boolean; origin: string;
  fields: Record<string, { exists: boolean; destination_safe: boolean }>;
  controls: Record<string, boolean>;
}
export interface CredentialDomRequestMap {
  classify_form: { form: HTMLFormElement | null; submitter: Element | null; currentUrl: string; baseUri: string };
  focused_group: { selector: string };
  attempt_probe: { fieldSelectors: string[]; controlSelectors: string[] };
  auto_probe: {};
  fill: { expected: BoundLoginGroup | null; requested: ControlledCredentialField[]; sensitiveAttr: string; preserveLegacyFieldBehavior: boolean };
  submit_auto: { selector: string | null };
  submit_explicit: { kind: 'click' | 'press_enter' | 'none'; selector: string | null };
}
export type CredentialDomOperation = keyof CredentialDomRequestMap;
export type CredentialDomInjectedOperation = Exclude<CredentialDomOperation, 'classify_form'>;
export type CredentialDomRequest = { [O in CredentialDomOperation]: { operation: O } & CredentialDomRequestMap[O] }[CredentialDomOperation];
export type CredentialDomInjectedRequest = { [O in CredentialDomInjectedOperation]: { operation: O } & CredentialDomRequestMap[O] }[CredentialDomInjectedOperation];
export interface CredentialDomResultMap {
  classify_form: FormDestination; focused_group: BoundLoginGroup | null; attempt_probe: SpecProbe; auto_probe: LoginFormProbe;
  fill: { ok: boolean; reason?: string }; submit_auto: { ok: boolean; mode: string }; submit_explicit: { ok: boolean; mode: string };
}
export type CredentialDomResult<O extends CredentialDomOperation> = CredentialDomResultMap[O];

export function credentialDomSource<O extends CredentialDomOperation>(request: { operation: O } & CredentialDomRequestMap[O]): CredentialDomResult<O>;
export function credentialDomSource(request: CredentialDomRequest): CredentialDomResultMap[CredentialDomOperation] {
  // Exact React DOM 19.2 and Next vendored literals. Unknown javascript: is unsafe.
  const reactLong = "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')";
  const nextShort = "javascript:throw new Error('React form unexpectedly submitted.')";
  const result = <T>(value: T): T => value;
  function submitControl(control: Element | null, form: HTMLFormElement): control is HTMLButtonElement | HTMLInputElement {
    if (!(control instanceof HTMLButtonElement || control instanceof HTMLInputElement) || control.form !== form) return false;
    const type = (control.getAttribute('type') ?? (control instanceof HTMLButtonElement ? 'submit' : 'text')).toLowerCase();
    return control instanceof HTMLButtonElement ? type === 'submit' : type === 'submit' || type === 'image';
  }
  function classifyOne(form: HTMLFormElement, control: Element | null, currentUrl: string, baseUri: string): FormDestination {
    const submitter = submitControl(control, form) ? control : null;
    const rawAction = submitter?.getAttribute('formaction') ?? form.getAttribute('action') ?? '';
    if (rawAction === reactLong || rawAction === nextShort) return { kind: 'react_action' };
    const rawMethod = submitter?.getAttribute('formmethod') ?? form.getAttribute('method') ?? 'get';
    if (rawMethod.toLowerCase() !== 'post') return { kind: 'unsafe', reason: 'method' };
    let target: URL; let current: URL;
    try { target = new URL(rawAction || currentUrl, rawAction ? baseUri : currentUrl); current = new URL(currentUrl); } catch { return { kind: 'unsafe', reason: 'url' }; }
    const loopback = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(target.hostname);
    if (target.origin !== current.origin) return { kind: 'unsafe', reason: 'origin' };
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && loopback)) return { kind: 'unsafe', reason: 'scheme' };
    return { kind: 'safe_post' };
  }
  function classify(form: HTMLFormElement | null, submitter: Element | null, currentUrl = location.href, baseUri = document.baseURI): FormDestination {
    if (!form) return { kind: 'safe_post' };
    const selected = submitControl(submitter, form) ? submitter : null;
    const primary = classifyOne(form, selected, currentUrl, baseUri);
    if (primary.kind === 'unsafe') return primary;
    for (const candidate of Array.from(form.elements)) {
      if (!submitControl(candidate, form) || candidate.disabled || candidate === selected) continue;
      if (!candidate.hasAttribute('formaction') && !candidate.hasAttribute('formmethod')) continue;
      if (classifyOne(form, candidate, currentUrl, baseUri).kind === 'unsafe') return { kind: 'unsafe', reason: 'override' };
    }
    return primary;
  }
  function inputFor(selector: string | null): HTMLInputElement | null { try { const node = selector ? document.querySelector(selector) : null; return node instanceof HTMLInputElement ? node : null; } catch { return null; } }
  function visibleEditable(input: HTMLInputElement | null): input is HTMLInputElement { if (!input || input.disabled || input.readOnly || input.type === 'hidden') return false; const r=input.getBoundingClientRect(), s=getComputedStyle(input); return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden'; }
  function visible(el: Element): boolean { return el instanceof HTMLElement && !(el as HTMLInputElement).disabled && (()=>{const r=el.getBoundingClientRect(), s=getComputedStyle(el); return (r.width>0 || r.height>0) && s.display!=='none' && s.visibility!=='hidden';})(); }
  function selectorFor(el: Element): string | null { const escape=(v:string)=>globalThis.CSS?.escape?.(v) ?? v.replace(/[^a-zA-Z0-9_-]/g,'\\$&'); const id=el.getAttribute('id'); if(id && document.querySelectorAll(`#${escape(id)}`).length===1)return `#${escape(id)}`; const name=el.getAttribute('name'); const tag=el.tagName.toLowerCase(); if(name){const x=`${tag}[name="${escape(name)}"]`; if(document.querySelectorAll(x).length===1)return x;} const parts:string[]=[]; let n:Element|null=el; while(n&&n!==document.body&&parts.length<8){const parent: Element | null=n.parentElement;if(!parent)return null;const siblings=Array.from(parent.children).filter((child: Element)=>child.tagName===n!.tagName);parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(n)+1})`);n=parent;}const x=parts.join(' > ');return x&&document.querySelectorAll(x).length===1?x:null; }
  function write(input: HTMLInputElement, value: string): void { const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')?.set; if(setter)setter.call(input,value);else input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); }
  function focused(selector:string): BoundLoginGroup|null { const anchor=inputFor(selector); if(!visibleEditable(anchor))return null; const autocomplete=(anchor.autocomplete||'').toLowerCase(), type=(anchor.type||'text').toLowerCase(); if(autocomplete==='one-time-code'||autocomplete==='new-password'||/otp|mfa|2fa|verification|confirm/i.test(`${anchor.name} ${anchor.id} ${anchor.placeholder}`))return null; const scope=anchor.closest('form')??anchor.parentElement??document.body; const inputs=Array.from(scope.querySelectorAll('input')).filter((i):i is HTMLInputElement=>visibleEditable(i)); const password=inputs.find(i=>(i.type||'').toLowerCase()==='password'&&i.autocomplete.toLowerCase()!=='new-password')??null; const username=inputs.find(i=>/^(username|email)$/i.test(i.autocomplete))??inputs.find(i=>/^(text|email|tel)$/i.test((i.type||'text').toLowerCase())&&/user|email|login|account|identifier/i.test(`${i.name} ${i.id} ${i.placeholder} ${i.getAttribute('aria-label')??''}`))??null; if(!((type==='password'&&autocomplete!=='new-password')||autocomplete==='username'))return null; const a=selectorFor(anchor),u=username&&selectorFor(username),p=password&&selectorFor(password); if(!a||(username&&!u)||(password&&!p)||inputs.filter(i=>(i.type||'').toLowerCase()==='password'&&i!==password).length)return null; if(classify(anchor.closest('form'),null).kind==='unsafe')return null; return {anchor:a,username:u,password:p,usernameOnly:!p,pageUrl:`${location.origin}${location.pathname}`}; }
  function autoProbe(): LoginFormProbe { const passwords=Array.from(document.querySelectorAll('input[type="password"]')).filter((i):i is HTMLInputElement=>visible(i)); const password=passwords[0]??null; const text=Array.from(document.querySelectorAll('input[type="text"],input[type="email"],input[type="tel"],input:not([type])')).filter((i):i is HTMLInputElement=>visible(i)); let username=text.find(i=>/^(username|email)$/i.test(i.getAttribute('autocomplete')??''))??null; if(!username&&password){const scope=password.closest('form')??document.body;const candidates=text.filter(i=>scope.contains(i));username=candidates[candidates.length-1]??null;} if(!username)username=text.find(i=>/user|email|login|account|identifier|phone|mobile/i.test(`${i.name} ${i.id} ${i.placeholder} ${i.getAttribute('aria-label')??''}`))??null; if(!username&&password&&text.length===1)username=text[0]??null; const anchor=password??username, form=anchor?.closest('form')??null; let submit:Element|null=form?.querySelector('button[type="submit"],input[type="submit"]')??null; if(!submit&&form)submit=form.querySelector('button:not([type])'); return {is_top_frame:window.top===window.self,origin:location.origin,href:location.href,username_selector:username&&selectorFor(username),password_selector:password&&selectorFor(password),submit_selector:submit&&selectorFor(submit),destination_safe:classify(form,submit).kind!=='unsafe'}; }
  function attemptProbe(fieldSelectors:string[],controlSelectors:string[]): SpecProbe { const controls:Record<string,boolean>={}; const selected:Record<string,Element|null>={}; for(const selector of controlSelectors){try{const e=document.querySelector(selector); controls[selector]=e instanceof HTMLElement;selected[selector]=e;}catch{controls[selector]=false;selected[selector]=null;}} const fields:SpecProbe['fields']={};for(const selector of fieldSelectors){let e:Element|null=null;try{e=document.querySelector(selector);}catch{} const form=e?.closest('form')??null; const submit=Object.values(selected).find(x=>x&&submitControl(x,form as HTMLFormElement))??null; fields[selector]={exists:e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement,destination_safe:classify(form,submit).kind!=='unsafe'};}return {is_top_frame:window.top===window.self,origin:location.origin,fields,controls}; }
  function fill(expected:BoundLoginGroup|null, requested:ControlledCredentialField[], sensitiveAttr:string, preserve:boolean):{ok:boolean;reason?:string}{ if(!expected){const f=requested[0];const input=f ? inputFor(f.selector) : null;if(requested.length!==1||!f||f.value===null||!visibleEditable(input)||classify(input.closest('form'),null).kind==='unsafe')return {ok:false,reason:'field_not_fillable'};if(sensitiveAttr)input.setAttribute(sensitiveAttr,'');if(preserve){input.scrollIntoView({block:'center',behavior:'instant'});input.focus();}write(input,f.value);if(preserve)input.dispatchEvent(new Event('blur',{bubbles:true}));return {ok:true};} const anchor=inputFor(expected.anchor),username=inputFor(expected.username),password=inputFor(expected.password);const same=(s:string|null,n:HTMLInputElement|null)=>s===null?n===null:!!n&&n.isConnected&&document.querySelector(s)===n;const safe=()=>{if(`${location.origin}${location.pathname}`!==expected.pageUrl||!same(expected.anchor,anchor)||!same(expected.username,username)||!same(expected.password,password)||!visibleEditable(anchor)||(expected.username&&!visibleEditable(username))||(expected.password&&!visibleEditable(password))||expected.usernameOnly!==!expected.password||classify(anchor.closest('form'),null).kind==='unsafe')return false;return true;}; const requestedMap=new Map(requested.map(x=>[x.selector,x.value]));const values:Array<[HTMLInputElement,string]>=[];const u=expected.username?requestedMap.get(expected.username):undefined,p=expected.password?requestedMap.get(expected.password):undefined;if(expected.username&&u!=null&&username)values.push([username,u]);if(expected.password&&p!=null&&password)values.push([password,p]);if(!safe()||!values.length||(expected.password&&p==null))return {ok:false};const written:HTMLInputElement[]=[];const clear=()=>{for(const input of written){const selector=input===username?expected.username:expected.password;if(same(selector,input))write(input,'');}};for(const [input,value]of values){if(sensitiveAttr)input.setAttribute(sensitiveAttr,'');if(!safe()){clear();return {ok:false};}write(input,value);written.push(input);if(!safe()){clear();return {ok:false};}}return {ok:true}; }
  function submitAuto(selector:string|null):{ok:boolean;mode:string}{let el:Element|null=null;try{el=selector?document.querySelector(selector):null;}catch{} const form=el?.closest('form')??(document.querySelector('input[type="password"],input')?.closest('form')??null);if(classify(form,el).kind==='unsafe')return {ok:false,mode:'unsafe_destination'};if(el instanceof HTMLElement&&submitControl(el,form as HTMLFormElement)){el.click();return {ok:true,mode:'click'};}if(!form||typeof form.requestSubmit!=='function')return {ok:false,mode:'none'};form.requestSubmit();return {ok:true,mode:'form'}; }
  function explicit(kind:'click'|'press_enter'|'none',selector:string|null):{ok:boolean;mode:string}{if(kind==='none')return {ok:true,mode:'none'};let el:Element|null=null;try{el=selector?document.querySelector(selector):null;}catch{} if(!el)return {ok:false,mode:'not_found'};const form=el.closest('form');if(classify(form,el).kind==='unsafe')return {ok:false,mode:'unsafe_destination'};if(kind==='click'&&el instanceof HTMLElement){el.click();return {ok:true,mode:'click'};}if(!form||typeof form.requestSubmit!=='function')return {ok:false,mode:'request_submit_unavailable'};form.requestSubmit();return {ok:true,mode:'press_enter'}; }
  switch(request.operation){case 'classify_form':return result(classify(request.form,request.submitter,request.currentUrl,request.baseUri)) as CredentialDomResultMap[CredentialDomOperation];case 'focused_group':return result(focused(request.selector)) as CredentialDomResultMap[CredentialDomOperation];case 'attempt_probe':return result(attemptProbe(request.fieldSelectors,request.controlSelectors)) as CredentialDomResultMap[CredentialDomOperation];case 'auto_probe':return result(autoProbe()) as CredentialDomResultMap[CredentialDomOperation];case 'fill':return result(fill(request.expected,request.requested,request.sensitiveAttr,request.preserveLegacyFieldBehavior)) as CredentialDomResultMap[CredentialDomOperation];case 'submit_auto':return result(submitAuto(request.selector)) as CredentialDomResultMap[CredentialDomOperation];case 'submit_explicit':return result(explicit(request.kind,request.selector)) as CredentialDomResultMap[CredentialDomOperation];}
}
