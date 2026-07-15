import { randomBytes } from 'node:crypto';

import { parse, parseFragment, serialize } from 'parse5';

import {
  isCapabilityToken,
  mintCapabilityToken,
  timingSafeTokenEqual,
} from '../design-engine/board-token.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '../pipeline/errors.mjs';

export const ARTIFACT_BRIDGE_CHANNEL = 'openplanr.artifact-anchor';
export const ARTIFACT_BRIDGE_VERSION = '1.0.0';
export const ARTIFACT_BRIDGE_EVENT = 'planr:artifact-anchor';
export const ARTIFACT_BRIDGE_READY_EVENT = 'planr:artifact-bridge-ready';
export const ARTIFACT_BRIDGE_LAYOUT_EVENT = 'planr:artifact-layout';
export const ARTIFACT_EXPORT_MAX_EDGE = 11_000;
export const ARTIFACT_EXPORT_MAX_DATA_URL = 24 * 1024 * 1024;
export const ARTIFACT_LAYOUT_MAX_WIDTH = 16_384;
export const ARTIFACT_LAYOUT_MAX_HEIGHT = 262_144;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SCRIPT_NONCE_RE = /^[A-Za-z0-9_-]{24}$/;
const FORBIDDEN_TAGS = new Set([
  'applet', 'base', 'embed', 'fencedframe', 'form', 'frame', 'frameset', 'iframe',
  'noembed', 'noframes', 'noscript', 'object', 'portal',
]);
const URL_ATTRIBUTES = new Set([
  'action', 'archive', 'background', 'classid', 'codebase', 'formaction', 'href',
  'longdesc', 'manifest', 'ping', 'profile', 'src', 'srcdoc', 'target', 'xlink:href',
]);
const REMOTE_URL_RE = /^(?:https?:|file:|ftp:|wss?:|\/\/)/i;

function pipelineError(code, message, details) {
  return new PipelineError(code, message, '', details);
}

function getAttr(node, name) {
  return node.attrs?.find((attribute) => attribute.name.toLowerCase() === name)?.value;
}

function setAttr(node, name, value) {
  const existing = node.attrs?.find((attribute) => attribute.name.toLowerCase() === name);
  if (existing) existing.value = value;
  else (node.attrs ??= []).push({ name, value });
}

function createElement(tagName) {
  return parseFragment(`<${tagName}></${tagName}>`).childNodes[0];
}

function createText(value, parentNode) {
  return { nodeName: '#text', value, parentNode };
}

function descendants(node) {
  return [
    ...(node?.childNodes ?? []),
    ...(node?.content?.childNodes ?? []),
  ];
}

function removeNode(node) {
  const parent = node.parentNode;
  const index = parent?.childNodes?.indexOf(node) ?? -1;
  if (index >= 0) parent.childNodes.splice(index, 1);
}

function findElement(document, tagName) {
  const queue = descendants(document);
  while (queue.length > 0) {
    const node = queue.shift();
    if (node?.tagName?.toLowerCase() === tagName) return node;
    queue.push(...descendants(node));
  }
  return null;
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(value, key) {
  const descriptor = isPlainRecord(value) ? Object.getOwnPropertyDescriptor(value, key) : null;
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function exactKeys(value, allowed) {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function bridgeFailure(reason, details) {
  return Object.freeze({
    ok: false,
    code: ARTIFACT_ERROR_CODES.BRIDGE_INVALID,
    reason,
    fallback: 'coordinates',
    ...(details === undefined ? {} : { details }),
  });
}

export function createArtifactBridgeNonce({ randomBytesImpl = randomBytes } = {}) {
  return mintCapabilityToken({ bytes: 32, randomBytesImpl });
}

export function artifactContentSecurityPolicy(scriptNonce) {
  if (typeof scriptNonce !== 'string' || !SCRIPT_NONCE_RE.test(scriptNonce)) {
    throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Artifact script nonce is invalid.');
  }
  return [
    "default-src 'none'",
    `script-src 'nonce-${scriptNonce}' data: blob:`,
    `script-src-elem 'nonce-${scriptNonce}' data: blob:`,
    "script-src-attr 'unsafe-inline'",
    "style-src 'unsafe-inline' data: blob:",
    'img-src data: blob:',
    'media-src data: blob:',
    'font-src data:',
    'worker-src data: blob:',
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

function assertSandboxableTree(document) {
  const queue = descendants(document);
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node?.tagName) {
      queue.push(...descendants(node));
      continue;
    }
    const tag = node.tagName.toLowerCase();
    if (FORBIDDEN_TAGS.has(tag)) {
      throw pipelineError(
        ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
        `Unsafe <${tag}> cannot enter an artifact review sandbox.`,
      );
    }
    if (tag === 'meta' && getAttr(node, 'http-equiv')?.trim().toLowerCase() === 'refresh') {
      throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Meta refresh navigation is forbidden.');
    }
    for (const attribute of node.attrs ?? []) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (['srcdoc', 'target', 'action', 'formaction'].includes(name)) {
        throw pipelineError(
          ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
          `Artifact navigation attribute ${name} is forbidden.`,
        );
      }
      if (URL_ATTRIBUTES.has(name) && REMOTE_URL_RE.test(value)) {
        throw pipelineError(
          ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
          `Remote artifact resource is forbidden: ${value.slice(0, 80)}`,
        );
      }
      if (name === 'style' && /(?:@import|url\s*\(\s*['"]?(?:https?:|file:|\/\/))/i.test(value)) {
        throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Remote inline CSS is forbidden.');
      }
    }
    if (tag === 'style') {
      const css = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
      if (/(?:@import|url\s*\(\s*['"]?(?:https?:|file:|\/\/))/i.test(css)) {
        throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Remote stylesheet resources are forbidden.');
      }
    }
    queue.push(...descendants(node));
  }
}

function artifactGuardAndBridgeSource({ artifactId, nonce, parentOrigin }) {
  const contract = JSON.stringify({
    channel: ARTIFACT_BRIDGE_CHANNEL,
    schemaVersion: ARTIFACT_BRIDGE_VERSION,
    artifactId,
    nonce,
    parentOrigin,
  });
  const workerGuard = `(()=>{
  'use strict';
  const blocked=()=>new DOMException('Blocked by OpenPlanr artifact sandbox','SecurityError');
  const replace=(owner,key,value)=>{try{Object.defineProperty(owner,key,{value,writable:false,configurable:false})}catch{try{owner[key]=value}catch{}}};
  const reject=()=>Promise.reject(blocked());
  replace(globalThis,'fetch',reject);
  for(const key of ['XMLHttpRequest','WebSocket','EventSource','WebTransport','RTCPeerConnection','webkitRTCPeerConnection']){
    if(key in globalThis)replace(globalThis,key,class{constructor(){throw blocked()}});
  }
  for(const key of ['indexedDB','caches','cookieStore']){
    try{Object.defineProperty(globalThis,key,{get(){throw blocked()},configurable:false})}catch{}
  }
  try{replace(Navigator.prototype,'sendBeacon',()=>false)}catch{}
  try{Object.defineProperty(Navigator.prototype,'serviceWorker',{get(){throw blocked()},configurable:false})}catch{}
  try{Object.defineProperty(Navigator.prototype,'clipboard',{get(){throw blocked()},configurable:false})}catch{}
  try{if(typeof StorageManager==='function'&&'getDirectory' in StorageManager.prototype)replace(StorageManager.prototype,'getDirectory',reject)}catch{}
  try{if(typeof StorageManager==='function'&&'persist' in StorageManager.prototype)replace(StorageManager.prototype,'persist',reject)}catch{}
  for(const key of ['Worker','SharedWorker']){
    if(key in globalThis)replace(globalThis,key,class{constructor(){throw blocked()}});
  }
  const nativeImportScripts=typeof importScripts==='function'?importScripts.bind(globalThis):null;
  if(nativeImportScripts)replace(globalThis,'importScripts',(...urls)=>{
    if(!urls.every(value=>/^(?:blob:|data:)/i.test(String(value))))throw blocked();
    return nativeImportScripts(...urls);
  });
})();`;
  return `(()=>{
  'use strict';
  const injectedScript=document.currentScript;
  injectedScript?.remove();
  const contract=${contract};
  const postToParent=parent.postMessage.bind(parent);
  const elementFromPoint=document.elementFromPoint.bind(document);
  const queryAll=document.querySelectorAll.bind(document);
  const elementClosest=Element.prototype.closest;
  const elementGetAttribute=Element.prototype.getAttribute;
  const elementSetAttribute=Element.prototype.setAttribute;
  const elementRect=Element.prototype.getBoundingClientRect;
  const nativeCloneNode=Node.prototype.cloneNode;
  const nativeAppendChild=Node.prototype.appendChild;
  const nativeCreateElement=Document.prototype.createElement;
  const nativeGetComputedStyle=globalThis.getComputedStyle.bind(globalThis);
  const nativeSerializeToString=XMLSerializer.prototype.serializeToString;
  const NativeImage=globalThis.Image;
  const nativeExecCommand=Document.prototype.execCommand;
  const nativeDocumentWrite=Document.prototype.write;
  const nativeDocumentWriteln=Document.prototype.writeln;
  const NativeWorker=globalThis.Worker;
  const NativeSharedWorker=globalThis.SharedWorker;
  const NativeBlob=globalThis.Blob;
  const NativeResizeObserver=globalThis.ResizeObserver;
  const nativeCreateObjectURL=URL.createObjectURL.bind(URL);
  const nativeRevokeObjectURL=URL.revokeObjectURL.bind(URL);
  const workerGuard=${JSON.stringify(workerGuard)};
  const blocked=()=>new DOMException('Blocked by OpenPlanr artifact sandbox','SecurityError');
  const replace=(owner,key,value)=>{try{Object.defineProperty(owner,key,{value,writable:false,configurable:false})}catch{try{owner[key]=value}catch{}}};
  const reject=()=>Promise.reject(blocked());
  const workerUrls=new Set();let liveWorkerCount=0;
  replace(globalThis,'fetch',reject);
  for(const key of ['XMLHttpRequest','WebSocket','EventSource','WebTransport','RTCPeerConnection','webkitRTCPeerConnection']){
    if(key in globalThis) replace(globalThis,key,class{constructor(){throw blocked()}});
  }
  replace(globalThis,'open',()=>null);
  try{replace(Navigator.prototype,'sendBeacon',()=>false)}catch{}
  try{Object.defineProperty(Navigator.prototype,'serviceWorker',{get(){throw blocked()},configurable:false})}catch{}
  try{Object.defineProperty(Navigator.prototype,'clipboard',{get(){throw blocked()},configurable:false})}catch{}
  try{if('share' in Navigator.prototype)replace(Navigator.prototype,'share',reject)}catch{}
  try{if(typeof StorageManager==='function'&&'getDirectory' in StorageManager.prototype)replace(StorageManager.prototype,'getDirectory',reject)}catch{}
  try{if(typeof StorageManager==='function'&&'persist' in StorageManager.prototype)replace(StorageManager.prototype,'persist',reject)}catch{}
  for(const key of ['localStorage','sessionStorage','indexedDB','caches','cookieStore']){
    try{Object.defineProperty(globalThis,key,{get(){throw blocked()},configurable:false})}catch{}
  }
  try{replace(HTMLFormElement.prototype,'submit',function(){throw blocked()});replace(HTMLFormElement.prototype,'requestSubmit',function(){throw blocked()})}catch{}
  try{replace(Document.prototype,'open',function(){throw blocked()})}catch{}
  try{if(typeof nativeDocumentWrite==='function')replace(Document.prototype,'write',function(...values){if(this.readyState!=='loading')throw blocked();return nativeDocumentWrite.apply(this,values)})}catch{}
  try{if(typeof nativeDocumentWriteln==='function')replace(Document.prototype,'writeln',function(...values){if(this.readyState!=='loading')throw blocked();return nativeDocumentWriteln.apply(this,values)})}catch{}
  try{if(typeof nativeExecCommand==='function')replace(Document.prototype,'execCommand',function(command,...args){
    if(['copy','cut','paste'].includes(String(command).toLowerCase()))throw blocked();
    return nativeExecCommand.call(this,command,...args);
  })}catch{}
  const workerWrapper=(url,options,Shared)=>{
    if(liveWorkerCount>=32)throw blocked();
    const source=String(url);
    if(!/^(?:blob:|data:)/i.test(source))throw blocked();
    const module=options&&options.type==='module';
    if(module)throw blocked();
    const loader='__planrLoadWorker('+JSON.stringify(source)+')';
    const body='(function(__planrLoadWorker){'+workerGuard+';'+loader+'})(globalThis.importScripts.bind(globalThis));';
    const wrapper=nativeCreateObjectURL(new NativeBlob([body],{type:'text/javascript'}));workerUrls.add(wrapper);liveWorkerCount+=1;
    try{
      const instance=Shared?new NativeSharedWorker(wrapper,options):new NativeWorker(wrapper,options);
      let released=false;const release=()=>{if(released)return;released=true;liveWorkerCount=Math.max(0,liveWorkerCount-1);workerUrls.delete(wrapper);nativeRevokeObjectURL(wrapper)};
      if(!Shared&&typeof instance.terminate==='function'){
        const terminate=instance.terminate.bind(instance);
        replace(instance,'terminate',()=>{release();return terminate()});
      }
      if(Shared&&instance.port&&typeof instance.port.close==='function'){
        const close=instance.port.close.bind(instance.port);
        replace(instance.port,'close',()=>{release();return close()});
      }
      return instance;
    }catch(error){liveWorkerCount=Math.max(0,liveWorkerCount-1);workerUrls.delete(wrapper);nativeRevokeObjectURL(wrapper);throw error}
  };
  const installWorker=(name,Native,Shared)=>{if(typeof Native!=='function')return;const Wrapped=function(url,options){return workerWrapper(url,options,Shared)};try{Object.defineProperty(Wrapped,'name',{value:name});Object.setPrototypeOf(Wrapped,Native);Object.defineProperty(Wrapped,'prototype',{value:Native.prototype})}catch{}replace(globalThis,name,Wrapped)};
  try{installWorker('Worker',NativeWorker,false)}catch{}
  try{installWorker('SharedWorker',NativeSharedWorker,true)}catch{}
  try{replace(Location.prototype,'assign',function(){throw blocked()});replace(Location.prototype,'replace',function(){throw blocked()})}catch{}
  try{navigation?.addEventListener('navigate',event=>{if(event.cancelable)event.preventDefault()})}catch{}
  addEventListener('click',event=>{if(event.target?.closest?.('a,[formaction]'))event.preventDefault()},true);
  addEventListener('submit',event=>event.preventDefault(),true);
  for(const type of ['copy','cut','paste'])addEventListener(type,event=>{event.preventDefault();event.stopImmediatePropagation()},true);
  addEventListener('pagehide',()=>{for(const url of workerUrls)nativeRevokeObjectURL(url);workerUrls.clear();liveWorkerCount=0},{once:true});

  const plain=value=>{if(!value||typeof value!=='object'||Array.isArray(value))return false;const prototype=Object.getPrototypeOf(value);return prototype===Object.prototype||prototype===null};
  const own=(value,key)=>{const descriptor=plain(value)?Object.getOwnPropertyDescriptor(value,key):null;return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined};
  const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
  const validText=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
  const validId=value=>validText(value,512)&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(value);
  const validScreen=value=>typeof value==='string'&&/^[^\\u0000-\\u001f\\u007f]{1,128}$/.test(value);
  const validRequestId=value=>validText(value,128)&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value);
  const validBase=(data,type,keys)=>exact(data,keys)
    &&own(data,'channel')===contract.channel&&own(data,'schemaVersion')===contract.schemaVersion
    &&own(data,'type')===type
    &&own(data,'artifactId')===contract.artifactId&&validRequestId(own(data,'requestId'));
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const closest=(element,selector)=>element?elementClosest.call(element,selector):null;
  const attribute=(element,name)=>element?elementGetAttribute.call(element,name):null;
  const screenFor=element=>attribute(closest(element,'[data-planr-screen]'),'data-planr-screen')||undefined;
  const anchorFor=element=>{
    const anchor=closest(element,'[data-planr-id]');
    if(!anchor)return null;
    const planrId=attribute(anchor,'data-planr-id');
    if(!validText(planrId,512))return null;
    const rect=elementRect.call(anchor);
    const width=Math.max(1,innerWidth),height=Math.max(1,innerHeight);
    const x=clamp(rect.left,0,width),y=clamp(rect.top,0,height);
    const right=clamp(rect.right,0,width),bottom=clamp(rect.bottom,0,height);
    const screen=screenFor(anchor);
    return {planrId,...(screen===undefined?{}:{screen}),rect:{x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)},viewport:{width,height}};
  };
  const findById=(id,screen)=>{for(const element of queryAll('[data-planr-id]')){
    if(attribute(element,'data-planr-id')!==id)continue;
    if(screen!==undefined&&screenFor(element)!==screen)continue;
    return element;
  }return null};
  const exportTarget=target=>{
    if(target==='full')return {node:document.body,label:'full'};
    let node=elementFromPoint(innerWidth/2,innerHeight/2);
    node=closest(node,'[data-planr-id],[data-dc-slot],[data-planr-screen],section[id]')||document.body;
    const label=attribute(node,'data-planr-screen')||attribute(node,'data-dc-slot')
      ||attribute(node,'data-planr-id')||attribute(node,'id')||'screen';
    return {node,label};
  };
  const exportPng=async target=>{
    const selected=exportTarget(target),node=selected.node;
    const width=Math.ceil(Math.max(node.scrollWidth||0,node.clientWidth||0,elementRect.call(node).width||0));
    const height=Math.ceil(Math.max(node.scrollHeight||0,node.clientHeight||0,elementRect.call(node).height||0));
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1
      ||width>${ARTIFACT_EXPORT_MAX_EDGE}||height>${ARTIFACT_EXPORT_MAX_EDGE}
      ||width*height>40000000)throw new Error('export dimensions are unavailable or too large');
    let count=0;
    const cloneStyled=src=>{
      if(++count>10000)throw new Error('export node limit exceeded');
      if(src.nodeType===8||(src.nodeType===1&&src.tagName==='SCRIPT'))return document.createTextNode('');
      const dst=nativeCloneNode.call(src,false);
      if(src.nodeType===1){
        const style=nativeGetComputedStyle(src);let css='';
        for(let index=0;index<style.length;index+=1){const name=style[index];css+=name+':'+style.getPropertyValue(name)+';'}
        elementSetAttribute.call(dst,'style',css+'animation:none;transition:none;');
        if(src.tagName==='CANVAS'){
          try{const image=nativeCreateElement.call(document,'img');image.src=src.toDataURL('image/png');elementSetAttribute.call(image,'style',css);return image}catch{}
        }
      }
      for(let child=src.firstChild;child;child=child.nextSibling)nativeAppendChild.call(dst,cloneStyled(child));
      return dst;
    };
    await (document.fonts?.ready?.catch(()=>{})??Promise.resolve());
    const clone=cloneStyled(node);
    if(clone.nodeType===1){elementSetAttribute.call(clone,'xmlns','http://www.w3.org/1999/xhtml');clone.style.boxShadow='none';clone.style.borderRadius='0'}
    const markup=nativeSerializeToString.call(new XMLSerializer(),clone);
    if(markup.length>10*1024*1024)throw new Error('export markup limit exceeded');
    const scale=clamp(Math.floor(${ARTIFACT_EXPORT_MAX_EDGE}/Math.max(width,height))||1,1,3);
    const outputWidth=width*scale,outputHeight=height*scale;
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+outputWidth+'" height="'+outputHeight
      +'" viewBox="0 0 '+width+' '+height+'"><foreignObject width="'+width+'" height="'+height+'">'
      +markup+'</foreignObject></svg>';
    const image=new NativeImage();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('render failed'));image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)});
    const canvas=nativeCreateElement.call(document,'canvas');canvas.width=outputWidth;canvas.height=outputHeight;
    canvas.getContext('2d').drawImage(image,0,0,outputWidth,outputHeight);
    const dataUrl=canvas.toDataURL('image/png');
    if(typeof dataUrl!=='string'||dataUrl.length>${ARTIFACT_EXPORT_MAX_DATA_URL})throw new Error('export PNG limit exceeded');
    return {dataUrl,width:outputWidth,height:outputHeight,label:String(selected.label).slice(0,128)};
  };
  const send=(type,requestId,anchor)=>{
    const message={channel:contract.channel,schemaVersion:contract.schemaVersion,type,nonce:contract.nonce,artifactId:contract.artifactId};
    if(requestId)message.requestId=requestId;
    if(anchor)message.anchor=anchor;
    postToParent(message,contract.parentOrigin);
  };
  const sendExport=(type,requestId,value)=>{
    const message={channel:contract.channel,schemaVersion:contract.schemaVersion,type,nonce:contract.nonce,artifactId:contract.artifactId,requestId};
    if(type==='export.result')Object.assign(message,value);
    else message.reason=String(value||'export failed').slice(0,256);
    postToParent(message,contract.parentOrigin);
  };
  let lastLayout='';let layoutTimer=0;
  const measureLayout=()=>{
    layoutTimer=0;
    const root=document.documentElement,body=document.body;
    const width=Math.ceil(Math.max(root?.scrollWidth||0,root?.clientWidth||0,body?.scrollWidth||0,body?.clientWidth||0,innerWidth||0));
    const height=Math.ceil(Math.max(root?.scrollHeight||0,root?.clientHeight||0,body?.scrollHeight||0,body?.clientHeight||0,innerHeight||0));
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1
      ||width>${ARTIFACT_LAYOUT_MAX_WIDTH}||height>${ARTIFACT_LAYOUT_MAX_HEIGHT})return;
    const signature=width+'x'+height;if(signature===lastLayout)return;lastLayout=signature;
    postToParent({channel:contract.channel,schemaVersion:contract.schemaVersion,type:'layout.measurement',nonce:contract.nonce,artifactId:contract.artifactId,layout:{width,height}},contract.parentOrigin);
  };
  const scheduleLayout=()=>{if(layoutTimer)return;layoutTimer=setTimeout(measureLayout,80)};
  try{if(typeof NativeResizeObserver==='function'){const observer=new NativeResizeObserver(scheduleLayout);observer.observe(document.documentElement);if(document.body)observer.observe(document.body)}}catch{}
  let windowStart=performance.now(),messageCount=0;
  addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==contract.parentOrigin)return;
    const now=performance.now();if(now-windowStart>1000){windowStart=now;messageCount=0}if(++messageCount>60)return;
    const data=event.data;
    if(validBase(data,'bridge.challenge',['channel','schemaVersion','type','artifactId','requestId'])){
      send('bridge.challenge-ack',data.requestId);scheduleLayout();return;
    }
    if(validBase(data,'export.request',['channel','schemaVersion','type','artifactId','requestId','target'])
      &&['screen','full'].includes(own(data,'target'))){
      exportPng(own(data,'target')).then(value=>sendExport('export.result',data.requestId,value))
        .catch(error=>sendExport('export.error',data.requestId,error?.message));return;
    }
    if(validBase(data,'anchor.hit-test',['channel','schemaVersion','type','artifactId','requestId','x','y'])){
      const x=own(data,'x'),y=own(data,'y');
      if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>innerWidth||y>innerHeight)return;
      const anchor=anchorFor(elementFromPoint(x,y));
      send(anchor?'anchor.result':'anchor.miss',data.requestId,anchor);return;
    }
    const resolveKeys=own(data,'screen')===undefined
      ?['channel','schemaVersion','type','artifactId','requestId','planrId']
      :['channel','schemaVersion','type','artifactId','requestId','planrId','screen'];
    if(validBase(data,'anchor.resolve',resolveKeys)){
      const planrId=own(data,'planrId'),screen=own(data,'screen');
      if(!validId(planrId)||(screen!==undefined&&!validScreen(screen)))return;
      const anchor=anchorFor(findById(planrId,screen));
      send(anchor?'anchor.result':'anchor.miss',data.requestId,anchor);
    }
  });
  const ready=()=>send('bridge.ready');
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{ready();scheduleLayout()},{once:true});else queueMicrotask(()=>{ready();scheduleLayout()});
})();`;
}

/**
 * Add the early artifact CSP and bridge without changing the canonical envelope
 * bytes. The returned HTML is an execution copy used only by the local viewer.
 */
export function prepareArtifactDocument({
  html,
  artifactId,
  nonce,
  parentOrigin,
  scriptNonce = mintCapabilityToken({ bytes: 18 }),
} = {}) {
  if (typeof html !== 'string' || html.length === 0) {
    throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Artifact HTML is required.');
  }
  if (typeof artifactId !== 'string' || !ID_RE.test(artifactId)) {
    throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Artifact id is invalid.');
  }
  if (!isCapabilityToken(nonce)) {
    throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Artifact bridge nonce is invalid.');
  }
  const originMatch = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(parentOrigin ?? '');
  const originPort = Number(originMatch?.[1]);
  if (!originMatch || !Number.isInteger(originPort) || originPort < 1 || originPort > 65_535
    || String(originPort) !== originMatch[1]) {
    throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Artifact parent origin must be IPv4 loopback.');
  }
  const document = parse(html, { sourceCodeLocationInfo: false });
  assertSandboxableTree(document);
  const head = findElement(document, 'head');
  if (!head) throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Artifact document has no head element.');

  for (const node of [...descendants(head)]) {
    if (node?.tagName?.toLowerCase() === 'meta') {
      const httpEquiv = getAttr(node, 'http-equiv')?.trim().toLowerCase();
      if (httpEquiv === 'content-security-policy') removeNode(node);
    }
  }
  const csp = artifactContentSecurityPolicy(scriptNonce);
  const cspMeta = createElement('meta');
  setAttr(cspMeta, 'http-equiv', 'Content-Security-Policy');
  setAttr(cspMeta, 'content', csp);
  cspMeta.parentNode = head;
  const referrerMeta = createElement('meta');
  setAttr(referrerMeta, 'name', 'referrer');
  setAttr(referrerMeta, 'content', 'no-referrer');
  referrerMeta.parentNode = head;
  const bridge = createElement('script');
  setAttr(bridge, 'nonce', scriptNonce);
  bridge.childNodes = [createText(artifactGuardAndBridgeSource({ artifactId, nonce, parentOrigin }), bridge)];
  bridge.parentNode = head;

  const queue = descendants(document);
  while (queue.length > 0) {
    const node = queue.shift();
    if (node?.tagName?.toLowerCase() === 'script') setAttr(node, 'nonce', scriptNonce);
    queue.push(...descendants(node));
  }
  head.childNodes = [cspMeta, referrerMeta, bridge, ...(head.childNodes ?? [])];
  return Object.freeze({ html: serialize(document), csp, scriptNonce });
}

/** Pure parent-side validator. Invalid messages preserve coordinate fallback. */
export function validateArtifactBridgeMessage(event, {
  source,
  nonce,
  artifactId,
  viewport,
  pendingRequestIds,
  pendingChallengeIds,
} = {}) {
  if (!source || !isCapabilityToken(nonce) || typeof artifactId !== 'string' || !ID_RE.test(artifactId)) {
    return bridgeFailure('contract');
  }
  if (!event || event.source !== source) return bridgeFailure('source');
  if (event.origin !== 'null') return bridgeFailure('origin');
  const data = event.data;
  if (!isPlainRecord(data)) return bridgeFailure('schema');
  const type = ownDataValue(data, 'type');
  const baseKeys = new Set(['channel', 'schemaVersion', 'type', 'nonce', 'artifactId']);
  if (type === 'bridge.ready') {
    if (!exactKeys(data, baseKeys)) return bridgeFailure('schema');
  } else if (type === 'layout.measurement') {
    if (!exactKeys(data, new Set([...baseKeys, 'layout']))) return bridgeFailure('schema');
  } else if (type === 'bridge.challenge-ack' || type === 'anchor.miss') {
    if (!exactKeys(data, new Set([...baseKeys, 'requestId']))) return bridgeFailure('schema');
  } else if (type === 'anchor.result') {
    if (!exactKeys(data, new Set([...baseKeys, 'requestId', 'anchor']))) return bridgeFailure('schema');
  } else if (type === 'export.error') {
    if (!exactKeys(data, new Set([...baseKeys, 'requestId', 'reason']))) return bridgeFailure('schema');
  } else if (type === 'export.result') {
    if (!exactKeys(data, new Set([
      ...baseKeys, 'requestId', 'dataUrl', 'width', 'height', 'label',
    ]))) return bridgeFailure('schema');
  } else {
    return bridgeFailure('type');
  }
  if (ownDataValue(data, 'channel') !== ARTIFACT_BRIDGE_CHANNEL
    || ownDataValue(data, 'schemaVersion') !== ARTIFACT_BRIDGE_VERSION) {
    return bridgeFailure('schema');
  }
  if (!timingSafeTokenEqual(ownDataValue(data, 'nonce'), nonce)) return bridgeFailure('nonce');
  if (ownDataValue(data, 'artifactId') !== artifactId) return bridgeFailure('artifact');
  if (type === 'bridge.ready') {
    return Object.freeze({
      ok: true,
      value: Object.freeze({ type, artifactId, authenticated: false }),
    });
  }
  if (type === 'layout.measurement') {
    const layout = ownDataValue(data, 'layout');
    if (!exactKeys(layout, new Set(['width', 'height']))) return bridgeFailure('layout');
    const layoutWidth = ownDataValue(layout, 'width');
    const layoutHeight = ownDataValue(layout, 'height');
    if (!Number.isInteger(layoutWidth) || !Number.isInteger(layoutHeight)
      || layoutWidth < 1 || layoutWidth > ARTIFACT_LAYOUT_MAX_WIDTH
      || layoutHeight < 1 || layoutHeight > ARTIFACT_LAYOUT_MAX_HEIGHT) {
      return bridgeFailure('layout');
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        type,
        artifactId,
        authenticated: true,
        layout: Object.freeze({ width: layoutWidth, height: layoutHeight }),
      }),
    });
  }

  const requestId = ownDataValue(data, 'requestId');
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) return bridgeFailure('request');
  if (type === 'bridge.challenge-ack') {
    if (!(pendingChallengeIds instanceof Set) || !pendingChallengeIds.has(requestId)) {
      return bridgeFailure('request');
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({ type, artifactId, requestId, authenticated: true }),
    });
  }
  if (!(pendingRequestIds instanceof Set) || !pendingRequestIds.has(requestId)) {
    return bridgeFailure('request');
  }
  if (type === 'export.error') {
    const reason = ownDataValue(data, 'reason');
    if (typeof reason !== 'string' || reason.length > 256) return bridgeFailure('export');
    return Object.freeze({
      ok: true,
      value: Object.freeze({ type, artifactId, requestId, reason }),
    });
  }
  if (type === 'export.result') {
    const dataUrl = ownDataValue(data, 'dataUrl');
    const exportWidth = ownDataValue(data, 'width');
    const exportHeight = ownDataValue(data, 'height');
    const label = ownDataValue(data, 'label');
    if (typeof dataUrl !== 'string' || dataUrl.length > ARTIFACT_EXPORT_MAX_DATA_URL
      || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)
      || !Number.isInteger(exportWidth) || !Number.isInteger(exportHeight)
      || exportWidth < 1 || exportHeight < 1
      || exportWidth > ARTIFACT_EXPORT_MAX_EDGE || exportHeight > ARTIFACT_EXPORT_MAX_EDGE
      || typeof label !== 'string' || label.length < 1 || label.length > 128) {
      return bridgeFailure('export');
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        type, artifactId, requestId, dataUrl, width: exportWidth, height: exportHeight, label,
      }),
    });
  }
  if (type === 'anchor.miss') {
    return Object.freeze({ ok: true, value: Object.freeze({ type, artifactId, requestId }) });
  }

  const anchor = ownDataValue(data, 'anchor');
  const anchorKeys = new Set(['planrId', 'rect', 'viewport']);
  if (isPlainRecord(anchor) && Object.hasOwn(anchor, 'screen')) anchorKeys.add('screen');
  if (!exactKeys(anchor, anchorKeys)) return bridgeFailure('anchor');
  const planrId = ownDataValue(anchor, 'planrId');
  const screen = ownDataValue(anchor, 'screen');
  if (typeof planrId !== 'string' || !ID_RE.test(planrId)
    || (screen !== undefined && (typeof screen !== 'string' || !/^[^\u0000-\u001f\u007f]{1,128}$/.test(screen)))) {
    return bridgeFailure('anchor');
  }
  const rect = ownDataValue(anchor, 'rect');
  const reportedViewport = ownDataValue(anchor, 'viewport');
  if (!exactKeys(rect, new Set(['x', 'y', 'width', 'height']))
    || !exactKeys(reportedViewport, new Set(['width', 'height']))) return bridgeFailure('geometry');
  const width = viewport?.width;
  const height = viewport?.height;
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || ownDataValue(reportedViewport, 'width') !== width
    || ownDataValue(reportedViewport, 'height') !== height) return bridgeFailure('viewport');
  const geometry = Object.fromEntries(
    ['x', 'y', 'width', 'height'].map((key) => [key, ownDataValue(rect, key)]),
  );
  if (!Object.values(geometry).every(finite)
    || geometry.x < 0 || geometry.y < 0 || geometry.width < 0 || geometry.height < 0
    || geometry.x + geometry.width > width || geometry.y + geometry.height > height) {
    return bridgeFailure('geometry');
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      type,
      artifactId,
      requestId,
      anchor: Object.freeze({
        planrId,
        ...(screen === undefined ? {} : { screen }),
        rect: Object.freeze(geometry),
        viewport: Object.freeze({ width, height }),
      }),
    }),
  });
}

/**
 * Generate the trusted parent bootstrap. It fetches token-protected HTML into
 * Blob URLs and exposes only a nonce/source-bound geometry client to the stage.
 */
export function renderArtifactParentRuntime({
  artifactBaseUrl,
  stageRuntimeUrl,
  adapterRuntimeUrl,
  nonce,
} = {}) {
  const canonicalPath = (value, { trailingSlash = false } = {}) => {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
      || value.includes('\\') || value.includes('?') || value.includes('#') || /[\u0000-\u001f]/.test(value)
      || /%(?:00|2f|5c)/i.test(value) || (trailingSlash ? !value.endsWith('/') : value.endsWith('/'))) return false;
    try {
      return value.split('/').filter(Boolean).every((segment) => {
        const decoded = decodeURIComponent(segment);
        return decoded !== '.' && decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\');
      });
    } catch { return false; }
  };
  if (!canonicalPath(artifactBaseUrl, { trailingSlash: true })
    || !canonicalPath(stageRuntimeUrl)
    || (adapterRuntimeUrl !== undefined && !canonicalPath(adapterRuntimeUrl))
    || !isCapabilityToken(nonce)) {
    throw pipelineError(ARTIFACT_ERROR_CODES.BRIDGE_INVALID, 'Artifact parent runtime configuration is invalid.');
  }
  const config = JSON.stringify({
    artifactBaseUrl,
    stageRuntimeUrl,
    adapterRuntimeUrl: adapterRuntimeUrl ?? null,
    nonce,
    channel: ARTIFACT_BRIDGE_CHANNEL,
    schemaVersion: ARTIFACT_BRIDGE_VERSION,
    anchorEvent: ARTIFACT_BRIDGE_EVENT,
    readyEvent: ARTIFACT_BRIDGE_READY_EVENT,
    layoutEvent: ARTIFACT_BRIDGE_LAYOUT_EVENT,
    navigationEvent: 'planr:artifact-navigation-blocked',
    frameCsp: [
      "default-src 'none'",
      "script-src 'unsafe-inline' data: blob:",
      "script-src-attr 'unsafe-inline'",
      "style-src 'unsafe-inline' data: blob:",
      'img-src data: blob:',
      'media-src data: blob:',
      'font-src data:',
      'worker-src data: blob:',
      "connect-src 'none'",
      "frame-src 'none'",
      "child-src 'none'",
      "object-src 'none'",
      "manifest-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; '),
  });
  return `(()=>{
  'use strict';
  const config=${config};
  const requestId=()=>crypto.randomUUID?.()||('request-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  const bridgeClient={attach({artifact,frame,getState}){
    const pending=new Map();let windowStart=performance.now(),messageCount=0;
    let immutableSource='',trustedLoad=false,recovering=false,navigationAttempts=0,failedClosed=false;
    let inertSource='';
    let pendingChallenge=null;let measuredLayout=null;
    const plain=value=>{if(!value||typeof value!=='object'||Array.isArray(value))return false;const prototype=Object.getPrototypeOf(value);return prototype===Object.prototype||prototype===null};
    const own=(value,key)=>{const descriptor=plain(value)?Object.getOwnPropertyDescriptor(value,key):null;return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined};
    const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
    const validText=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
    const validId=value=>validText(value,512)&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(value);
    const validScreen=value=>typeof value==='string'&&/^[^\\u0000-\\u001f\\u007f]{1,128}$/.test(value);
    const validRequestId=value=>validText(value,128)&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value);
    const validNumber=value=>typeof value==='number'&&Number.isFinite(value);
    const originalPointerEvents=frame.style.pointerEvents;
    const originalInert=frame.inert;
    const quarantine=active=>{
      frame.inert=active?true:originalInert;
      frame.style.pointerEvents=active?'none':originalPointerEvents;
      if(active)frame.setAttribute('aria-busy','true');else frame.removeAttribute('aria-busy');
      frame.dataset.planrBridgeTrusted=String(!active);
    };
    frame.setAttribute('csp',config.frameCsp);
    quarantine(true);
    const receive=event=>{
      if(event.source!==frame.contentWindow||event.origin!=='null')return;
      const now=performance.now();if(now-windowStart>1000){windowStart=now;messageCount=0}if(++messageCount>120)return;
      const data=event.data;if(!data||typeof data!=='object'||Array.isArray(data))return;
      if(own(data,'channel')!==config.channel||own(data,'schemaVersion')!==config.schemaVersion||own(data,'nonce')!==config.nonce||own(data,'artifactId')!==artifact.id)return;
      const type=own(data,'type');
      if(type==='bridge.ready'){
        if(!exact(data,['channel','schemaVersion','type','nonce','artifactId']))return;
        return;
      }
      if(type==='bridge.challenge-ack'){
        if(!exact(data,['channel','schemaVersion','type','nonce','artifactId','requestId'])
          ||!validRequestId(own(data,'requestId'))||!pendingChallenge||own(data,'requestId')!==pendingChallenge.id)return;
        clearTimeout(pendingChallenge.timer);pendingChallenge=null;
        trustedLoad=true;recovering=false;
        quarantine(false);
        frame.dispatchEvent(new CustomEvent(config.readyEvent,{detail:{artifactId:artifact.id,authenticated:true}}));return;
      }
      if(type==='layout.measurement'){
        const layout=own(data,'layout');
        if(!trustedLoad||!exact(data,['channel','schemaVersion','type','nonce','artifactId','layout'])
          ||!exact(layout,['width','height'])||!Number.isInteger(layout.width)||!Number.isInteger(layout.height)
          ||layout.width<1||layout.width>${ARTIFACT_LAYOUT_MAX_WIDTH}
          ||layout.height<1||layout.height>${ARTIFACT_LAYOUT_MAX_HEIGHT})return;
        measuredLayout=Object.freeze({width:layout.width,height:layout.height});
        frame.dispatchEvent(new CustomEvent(config.layoutEvent,{detail:measuredLayout}));return;
      }
      const receivedRequestId=own(data,'requestId');
      if(!trustedLoad||!validRequestId(receivedRequestId)||!pending.has(receivedRequestId))return;
      const settle=pending.get(receivedRequestId);
      if(settle.type==='export.request'){
        if(type==='export.error'){
          if(!exact(data,['channel','schemaVersion','type','nonce','artifactId','requestId','reason'])
            ||typeof own(data,'reason')!=='string'||own(data,'reason').length>256)return;
          pending.delete(receivedRequestId);clearTimeout(settle.timer);settle.resolve(null);return;
        }
        if(type!=='export.result'||!exact(data,['channel','schemaVersion','type','nonce','artifactId','requestId','dataUrl','width','height','label']))return;
        const dataUrl=own(data,'dataUrl'),width=own(data,'width'),height=own(data,'height'),label=own(data,'label');
        pending.delete(receivedRequestId);clearTimeout(settle.timer);
        if(typeof dataUrl!=='string'||dataUrl.length>${ARTIFACT_EXPORT_MAX_DATA_URL}||!/^data:image\\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)
          ||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1
          ||width>${ARTIFACT_EXPORT_MAX_EDGE}||height>${ARTIFACT_EXPORT_MAX_EDGE}||!validText(label,128)){settle.resolve(null);return}
        settle.resolve(Object.freeze({dataUrl,width,height,label}));return;
      }
      if(!['anchor.result','anchor.miss'].includes(type))return;
      if(type==='anchor.miss'&&!exact(data,['channel','schemaVersion','type','nonce','artifactId','requestId']))return;
      if(type==='anchor.result'&&!exact(data,['channel','schemaVersion','type','nonce','artifactId','requestId','anchor']))return;
      pending.delete(receivedRequestId);clearTimeout(settle.timer);
      if(type==='anchor.miss'){settle.resolve(null);return}
      const anchor=data.anchor,rect=anchor?.rect,viewport=anchor?.viewport;
      const frozen=getState?.()?.presentation==='document'&&measuredLayout?measuredLayout:artifact.viewport;
      const anchorKeys=anchor?.screen===undefined?['planrId','rect','viewport']:['planrId','screen','rect','viewport'];
      if(!exact(anchor,anchorKeys)||!exact(rect,['x','y','width','height'])||!exact(viewport,['width','height'])
        ||!validId(anchor?.planrId)||(anchor.screen!==undefined&&!validScreen(anchor.screen))
        ||!['x','y','width','height'].every(key=>validNumber(rect?.[key]))
        ||viewport?.width!==frozen.width||viewport?.height!==frozen.height
        ||rect.x<0||rect.y<0||rect.width<0||rect.height<0
        ||rect.x+rect.width>frozen.width||rect.y+rect.height>frozen.height){settle.resolve(null);return}
      const value=Object.freeze({artifactId:artifact.id,planrId:anchor.planrId,...(anchor.screen===undefined?{}:{screen:anchor.screen}),rect:Object.freeze({...rect}),viewport:frozen});
      settle.resolve(value);frame.dispatchEvent(new CustomEvent(config.anchorEvent,{detail:value}));
    };
    addEventListener('message',receive);
    const rememberSource=()=>{if(immutableSource)return;const html=frame.getAttribute('srcdoc')||'';if(html){immutableSource={type:'srcdoc',value:html};return}const value=frame.getAttribute('src')||'';if(value.startsWith('blob:'))immutableSource={type:'url',value}};
    const sourceObserver=new MutationObserver(rememberSource);sourceObserver.observe(frame,{attributes:true,attributeFilter:['src','srcdoc']});
    const settlePending=()=>{for(const value of pending.values()){clearTimeout(value.timer);value.resolve(null)}pending.clear()};
    const clearChallenge=()=>{if(pendingChallenge){clearTimeout(pendingChallenge.timer);pendingChallenge=null}};
    const failClosed=()=>{
      if(failedClosed)return;failedClosed=true;recovering=false;clearChallenge();settlePending();
      quarantine(true);
      const inertPolicy=config.frameCsp.replaceAll('&','&amp;').replaceAll('"','&quot;');
      inertSource=URL.createObjectURL(new Blob(['<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+inertPolicy+'"><meta name="referrer" content="no-referrer"><title>Artifact blocked</title><p>Artifact navigation was blocked.</p>'],{type:'text/html'}));
      frame.dispatchEvent(new CustomEvent(config.navigationEvent,{detail:{artifactId:artifact.id,recovered:false,failedClosed:true,attempts:navigationAttempts}}));
      frame.removeAttribute('srcdoc');frame.src=inertSource;
    };
    const recoverNavigation=()=>{
      if(failedClosed||!immutableSource)return;
      navigationAttempts+=1;
      if(navigationAttempts>=3){failClosed();return}
      recovering=true;trustedLoad=false;quarantine(true);clearChallenge();
      frame.dispatchEvent(new CustomEvent(config.navigationEvent,{detail:{artifactId:artifact.id,recovered:true,failedClosed:false,attempts:navigationAttempts}}));
      if(immutableSource.type==='srcdoc'){frame.removeAttribute('src');frame.removeAttribute('srcdoc');frame.srcdoc=immutableSource.value}else{frame.removeAttribute('srcdoc');frame.src=immutableSource.value}
    };
    const challengeCurrentDocument=()=>{
      if(failedClosed)return;clearChallenge();
      const id=requestId();
      const timer=setTimeout(()=>{if(pendingChallenge?.id!==id)return;pendingChallenge=null;recoverNavigation()},750);
      pendingChallenge={id,timer};
      frame.contentWindow?.postMessage({channel:config.channel,schemaVersion:config.schemaVersion,type:'bridge.challenge',artifactId:artifact.id,requestId:id},'*');
    };
    const onFrameLoad=()=>{
      rememberSource();
      trustedLoad=false;measuredLayout=null;quarantine(true);
      challengeCurrentDocument();
    };
    frame.addEventListener('load',onFrameLoad);
    const send=(type,payload={})=>new Promise(resolve=>{
      if(!trustedLoad||pending.size>=32){resolve(null);return}
      const id=requestId();const timer=setTimeout(()=>{pending.delete(id);resolve(null)},750);
      pending.set(id,{resolve,timer,type});
      frame.contentWindow?.postMessage({channel:config.channel,schemaVersion:config.schemaVersion,type,artifactId:artifact.id,requestId:id,...payload},'*');
    });
    Object.defineProperty(frame,'__openPlanrBridge',{value:Object.freeze({
      hitTest:(x,y)=>Number.isFinite(x)&&Number.isFinite(y)?send('anchor.hit-test',{x,y}):Promise.resolve(null),
      resolve:(planrId,screen)=>validText(planrId,512)?send('anchor.resolve',{planrId,...(screen?{screen}:{})}):Promise.resolve(null),
      exportPng:target=>['screen','full'].includes(target)?send('export.request',{target}):Promise.resolve(null),
    }),configurable:true});
    return()=>{removeEventListener('message',receive);frame.removeEventListener('load',onFrameLoad);sourceObserver.disconnect();clearChallenge();settlePending();if(inertSource)URL.revokeObjectURL(inertSource);frame.inert=originalInert;frame.style.pointerEvents=originalPointerEvents;frame.removeAttribute('aria-busy');frame.removeAttribute('csp');delete frame.dataset.planrBridgeTrusted;try{delete frame.__openPlanrBridge}catch{}};
  }};
  globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__=Object.freeze({
    async resolveArtifactSource(artifact){
      const response=await fetch(config.artifactBaseUrl+encodeURIComponent(artifact.id),{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok||!(response.headers.get('content-type')||'').toLowerCase().startsWith('application/octet-stream'))throw new Error('Artifact source unavailable');
      return new Blob([await response.arrayBuffer()],{type:'text/html'});
    },
    bridgeClient,
    onState(state){dispatchEvent(new CustomEvent('planr:artifact-state',{detail:state}))},
  });
  const loadStage=()=>{const stage=document.createElement('script');stage.src=config.stageRuntimeUrl;stage.async=false;document.head.append(stage)};
  if(config.adapterRuntimeUrl){
    const adapter=document.createElement('script');adapter.src=config.adapterRuntimeUrl;adapter.async=false;
    adapter.addEventListener('load',loadStage,{once:true});
    adapter.addEventListener('error',()=>{document.documentElement.dataset.planrAdapterError='true'},{once:true});
    document.head.append(adapter);
  }else loadStage();
})();`;
}
