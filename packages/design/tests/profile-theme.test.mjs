import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createArtifactEnvelope} from '@openplanr/artifact/envelope.mjs';
import {mountArtifactStage} from '@openplanr/artifact/ui/stage.mjs';
import {renderDesignStudio,createDesignStudioEntries,designStudioArtifactId} from '../lib/design/studio.mjs';
const {JSDOM}=createRequire(new URL('../../cli/package.json',import.meta.url))('jsdom');
const runtime=readFileSync(new URL('../templates/studio/studio.js',import.meta.url),'utf8');
const enhancements=readFileSync(new URL('../templates/studio/enhancements.js',import.meta.url),'utf8');
const scope='openplanr.experience./d/profile-test';

async function mount({storage={},url='https://share.test/d/profile-test',options={},identity}={}) {
  const document={kind:'openplanr-design-document',schemaVersion:'1.0.0',id:'profile-test',title:'Team review',brief:{text:'Review the primary action.',source:'describe',provenance:'inferred'},frames:[{id:'desktop',label:'Desktop',width:1440,height:1024}],screens:[{id:'overview',title:'Overview',source:{html:'overview.html'}}],screenOrder:['overview'],variants:[{id:'primary',label:'Primary',status:'ready'}],selectedVariant:'primary',defaultView:'canvas'};
  const envelope=createArtifactEnvelope({artifacts:[{id:designStudioArtifactId('primary','overview','desktop'),title:'Overview',html:'<!doctype html><main><button>Continue</button></main>',viewport:{width:1440,height:1024}}]});
  const entries=createDesignStudioEntries(document,envelope);
  const dom=new JSDOM(renderDesignStudio({document,envelope,entries,revision:'revision-one'}),{url,runScripts:'outside-only',pretendToBeVisual:true});
  const {window}=dom;window.TextDecoder=TextDecoder;window.Blob=Blob;window.structuredClone=structuredClone;
  window.URL.createObjectURL=()=>`blob:https://share.test/${Math.random()}`;window.URL.revokeObjectURL=()=>{};
  window.HTMLElement.prototype.scrollTo=function(value){this.scrollLeft=value.left||0;this.scrollTop=value.top||0;};window.HTMLElement.prototype.scrollIntoView=()=>{};
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const media=new window.EventTarget();media.matches=true;window.matchMedia=()=>media;
  for(const [key,value] of Object.entries(storage))window.localStorage.setItem(key,value);
  window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__=options;
  const stage=mountArtifactStage({document:window.document,window,async resolveArtifactSource(artifact,{frame}){setTimeout(()=>frame.dispatchEvent(new window.Event('load')),0);return artifact.html;}});
  if(identity)stage.review.setIdentity(identity);
  window.eval(runtime);await stage.ready;await delay(20);window.eval(enhancements);await delay(20);
  return {window,document:window.document,stage,media,experience:window.__openPlanrDesignExperience,studio:window.__openPlanrDesignStudio,close(){window.__openPlanrDesignStudio.destroy();stage.destroy();window.close();}};
}
const click=(app,label)=>{const button=[...app.document.querySelectorAll('dialog button')].find(value=>value.textContent===label);assert.ok(button,`Button ${label} exists`);button.click();};

test('first welcome leads to a named profile without exposing a separate board step',async()=>{
  let ready=false;const value=await mount({options:{onExperienceReady(){ready=true;},loadExperience:()=>new Promise(()=>{})}});
  try{
    assert.equal(ready,true);assert.equal(value.document.querySelector('dialog').dataset.designWelcomeStep,'intro');
    assert.equal(value.window.localStorage.getItem(`${scope}.welcomed`),null);
    click(value,'Start walkthrough');assert.equal(value.document.querySelector('dialog').dataset.designWelcomeStep,'profile');
    assert.equal(value.window.localStorage.getItem(`${scope}.welcomed`),null,'advancing the intro does not mark dismissal');
    const name=value.document.querySelector('[name="reviewer-name"]');name.value='Rae Lee';name.dispatchEvent(new value.window.Event('input',{bubbles:true}));
    const color=value.document.querySelector('[name="avatar-color"][value="violet"]');color.checked=true;color.dispatchEvent(new value.window.Event('change',{bubbles:true}));
    value.document.querySelector('form.design-profile-form').dispatchEvent(new value.window.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(value.document.querySelector('dialog'),null);assert.deepEqual(value.stage.review.getState().identity,{name:'Rae Lee'});
    assert.deepEqual(JSON.parse(value.window.localStorage.getItem(`${scope}.profile`)),{name:'Rae Lee',color:'violet'});
    assert.equal(value.window.localStorage.getItem(`${scope}.welcomed`),'true');assert.equal(value.studio.getState().view,'walkthrough');
    assert.equal(value.document.querySelector('[data-design-profile-button] [data-avatar-color]').dataset.avatarColor,'violet');
  }finally{value.close();}
});

test('browse-first and canceled profile preserve unnamed access without saving a draft name',async()=>{
  const value=await mount();try{
    click(value,'Explore freely');const name=value.document.querySelector('[name="reviewer-name"]');name.value='Unfinished name';name.dispatchEvent(new value.window.Event('input',{bubbles:true}));
    click(value,'Browse first');assert.equal(value.stage.review.getState().identity,null);assert.equal(value.window.localStorage.getItem(`${scope}.profile`),null);
    value.experience.profile();click(value,'Cancel');assert.equal(value.window.localStorage.getItem(`${scope}.profile`),null);
    assert.equal(value.window.localStorage.getItem(`${scope}.welcomed`),'true');
  }finally{value.close();}
});

test('remembered profile seeds canonical identity and later edits preserve an existing identity id',async()=>{
  const value=await mount({storage:{[`${scope}.profile`]:JSON.stringify({name:'Rae Lee',color:'blue'}),[`${scope}.welcomed`]:'true'}});try{
    assert.equal(value.document.querySelector('dialog'),null);assert.deepEqual(value.stage.review.getState().identity,{name:'Rae Lee'});
    let notifications=0;value.window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__.onProfileChange=profile=>{notifications++;value.stage.review.setIdentity({id:'stable-reviewer',name:profile.name});};
    value.stage.review.setIdentity({id:'stable-reviewer',name:'Rae Lee'});value.experience.profile();
    const name=value.document.querySelector('[name="reviewer-name"]');name.value='Rae';name.dispatchEvent(new value.window.Event('input',{bubbles:true}));
    value.document.querySelector('form.design-profile-form').dispatchEvent(new value.window.Event('submit',{bubbles:true,cancelable:true}));
    assert.deepEqual(value.stage.review.getState().identity,{id:'stable-reviewer',name:'Rae'});
    assert.equal('color' in value.stage.review.getState().identity,false,'appearance stays out of frozen shared identity');
    assert.equal(notifications,1,'host identity enrichment does not cause profile notification recursion');
  }finally{value.close();}
});

test('dark default, explicit light and system changes stay personal to the shell',async()=>{
  const value=await mount({storage:{[`${scope}.welcomed`]:'true'}});try{
    const html=value.document.documentElement;const frame=value.document.querySelector('iframe');const source=frame.src;
    assert.equal(html.dataset.designTheme,'dark');assert.equal(value.stage.getState().theme,'dark');
    value.experience.setTheme('system');assert.equal(html.dataset.designTheme,'light');assert.equal(html.dataset.planrTheme,'light');
    value.media.matches=false;value.media.dispatchEvent(new value.window.Event('change'));assert.equal(html.dataset.designTheme,'dark');
    value.experience.setTheme('light');value.media.matches=true;value.media.dispatchEvent(new value.window.Event('change'));value.media.matches=false;value.media.dispatchEvent(new value.window.Event('change'));
    assert.equal(html.dataset.designTheme,'light');assert.equal(value.stage.getState().theme,'light');assert.equal(value.window.localStorage.getItem('openplanr.design.theme'),'light');
    assert.equal(frame.src,source,'theme does not regenerate or alter authored frames');
    assert.equal(html.dataset.designThemePreference,'light');
  }finally{value.close();}
});

test('destruction of an undisclosed welcome does not remember it as dismissed',async()=>{
  const value=await mount();try{value.studio.destroy();assert.equal(value.window.localStorage.getItem(`${scope}.welcomed`),null);}finally{value.close();}
});

test('personal avatar changes distinguish authors with the same name and different ids',async()=>{
  const value=await mount({identity:{name:'Rae',id:'me'},storage:{[`${scope}.profile`]:JSON.stringify({name:'Rae',color:'blue'}),[`${scope}.welcomed`]:'true'}});try{
    const pin={artifactId:designStudioArtifactId('primary','overview','desktop'),viewport:{width:1440,height:1024},region:{x:.1,y:.1,w:0,h:0},intent:'question',comment:'My comment'};
    value.stage.review.dispatch({type:'add-pin',pin});
    value.stage.review.dispatch({type:'add-pin',author:{name:'Rae',id:'another-person'},pin:{...pin,comment:'Another person'}});
    const colors=()=>[...value.document.querySelectorAll('.planr-review-byline .design-avatar')].map(node=>node.dataset.avatarColor);
    const before=colors();assert.equal(before[0],'blue');
    value.experience.profile();const radio=value.document.querySelector('[name="avatar-color"][value="rose"]');radio.checked=true;radio.dispatchEvent(new value.window.Event('change',{bubbles:true}));click(value,'Save profile');
    const after=colors();assert.equal(after[0],'rose');assert.equal(after[1],before[1],'identical display names do not imply the same author');
    assert.equal(value.stage.review.getState().review.pins[1].author.id,'another-person');
  }finally{value.close();}
});

test('personal reply drafts and expansion survive reopening the same local revision',async()=>{
  const url='http://127.0.0.1/local-review';let storage;
  const first=await mount({url});try{
    first.stage.review.setIdentity({name:'Rae'});
    first.stage.review.dispatch({type:'add-pin',pin:{artifactId:designStudioArtifactId('primary','overview','desktop'),viewport:{width:1440,height:1024},region:{x:.1,y:.1,w:0,h:0},intent:'question',comment:'Can the primary action be clearer?'}});
    await first.studio.flush();
    first.document.querySelector('[data-planr-reply-toggle]').click();
    const input=first.document.querySelector('[data-planr-reply-form] textarea');input.value='A reply I am still writing';input.dispatchEvent(new first.window.Event('input',{bubbles:true}));
    storage=Object.fromEntries(Array.from({length:first.window.localStorage.length},(_,index)=>{const key=first.window.localStorage.key(index);return [key,first.window.localStorage.getItem(key)];}));
    const draft=JSON.parse(storage['openplanr.experience.profile-test.review-drafts.revision-one']);
    assert.deepEqual(Object.values(draft.replies),['A reply I am still writing']);assert.equal(draft.expandedReplies.length,1);
  }finally{first.close();}
  const second=await mount({url,storage});try{
    assert.equal(second.document.querySelector('[data-planr-reply-form] textarea').value,'A reply I am still writing');
    assert.equal(second.document.querySelector('[data-planr-reply-toggle]').getAttribute('aria-expanded'),'true');
  }finally{second.close();}
});
