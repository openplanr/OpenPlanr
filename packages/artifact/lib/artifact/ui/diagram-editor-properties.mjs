import { element, button, field } from './diagram-editor-dom.mjs';
import { clone, elementIndex, parentIndex, geometryFields, appearanceFields, semanticFields } from '../diagram/authoring/model.mjs';
import { propertyTransaction, labelOf, moveOrthogonalBend } from './diagram-editor-actions.mjs';

/** Context-specific controls; validation and mutation remain in the session. */
export function renderDiagramProperties({ root, state, editable, act, submitTransaction }) {
  const document = root.ownerDocument, bundle = state.bundle, ids = state.view.selection;
  root.replaceChildren();
  if (!bundle) { root.append(element(document, 'p', {}, 'Access changed. Reopen this diagram with a current owner session.')); return; }
  const byId = elementIndex(bundle.document), placements = new Map(bundle.presentation.elements.map(item => [item.elementId, item]));
  const heading = element(document, 'h2', {}, ids.length === 0 ? 'Diagram details' : ids.length > 1 ? `${ids.length} objects selected` : labelOf(byId.get(ids[0]).value));
  root.append(heading);
  if (!ids.length) {
    root.append(element(document, 'p', { className: 'de-muted' }, bundle.document.title), element(document, 'p', {}, editable ? 'Select an object on the canvas or in the outline to edit its properties.' : 'Select an object to inspect its properties.'), element(document, 'p', { className: 'de-muted' }, `Profile: ${bundle.document.grammar.id}. Layout and meaning are saved together.`));
    const title = field(document, 'Diagram title', bundle.document.title, { maxlength: 240, disabled: !editable }); root.append(title.label);
    const changeTitle = button(document, 'Update title', 'update-title', { disabled: !editable }); changeTitle.onclick = () => act('update-title', title.input.value); root.append(changeTitle);
    return;
  }
  const actionRow = (...items) => { const row = element(document, 'div', { className: 'de-actions' }); for (const [name, action] of items) row.append(button(document, name, action, { disabled: !editable })); root.append(row); };
  if (ids.length > 1) {
    root.append(element(document, 'p', { className: 'de-muted' }, ids.slice(0, 8).map(id => labelOf(byId.get(id).value)).join(', ')));
    actionRow(['Align left','align-left'],['Align top','align-top'],['Align centers','align-center']);
    actionRow(['Distribute horizontally','distribute-horizontal'],['Distribute vertically','distribute-vertical']);
    actionRow(['Group selection','group'],['Ungroup selection','ungroup'],['Connect selection','connect']);
    actionRow(['Copy','copy'],['Paste','paste'],['Duplicate','duplicate']);
    actionRow(['Lock selection','lock'],['Unlock selection','unlock'],['Delete selection…','delete']);
    parentControl(ids);
    return;
  }
  const id = ids[0], entry = byId.get(id), place = placements.get(id), sem = semanticFields(entry.collection, entry.value), geom = geometryFields(place), look = appearanceFields(place);
  const form = element(document, 'form', { className: 'de-properties-form', 'aria-label': 'Object properties' });
  const inputs = new Map();
  const add = (name, value, options = {}) => { const item = field(document, name, value, { disabled: !editable, ...options }); inputs.set(name,item.input); form.append(item.label); return item.input; };
  add('Label', labelOf(entry.value), { maxlength: 500 });
  if (entry.collection === 'nodes') {
    add('Description', sem.description, { multiline: true, maxlength: 4000 });
    add('Semantic role', sem.kind, { choices: ['process','start','end','decision','data-store','component'] });
  }
  if (geom.bounds) {
    const grid = element(document, 'div', { className: 'de-field-grid' });
    for (const [name,key] of [['X','x'],['Y','y'],['Width','width'],['Height','height']]) {
      const lock = ['x','y'].includes(key) ? place.locks.position : place.locks.size;
      const item = field(document,name,geom.bounds[key],{type:'number',step:'1', min: ['width','height'].includes(key)?1:-1000000,max:1000000, disabled:!editable||lock});
      inputs.set(name,item.input);grid.append(item.label);
    }
    form.append(grid);
    if (place.locks.position || place.locks.size) form.append(element(document,'p',{className:'de-muted'},'Geometry is locked. Use Unlock selection to change it.'));
  }
  if (entry.collection === 'relations') {
    const choices=bundle.document.nodes.map(node=>[node.id,node.label]);
    add('From',sem.from,{choices});add('To',sem.to,{choices});
    add('Direction',sem.direction,{choices:[['forward','Forward'],['both','Both directions'],['none','No arrow']]});
    add('Relationship',sem.kind,{choices:['association','dependency','flow','message','transition']});
    add('Routing',geom.route.strategy,{choices:['straight','orthogonal'],disabled:!editable||place.locks.route});
    add('Start side',geom.route.from.side,{choices:['top','right','bottom','left'],disabled:!editable||place.locks.route});
    add('End side',geom.route.to.side,{choices:['top','right','bottom','left'],disabled:!editable||place.locks.route});
    const bends=element(document,'fieldset');bends.append(element(document,'legend',{},'Bend points'));
    const points=geom.route.mode==='manual'?geom.route.points.slice(1,-1):[];
    points.forEach((point,index)=>{
      const row=element(document,'div',{className:'de-field-grid'});
      for(const key of ['x','y']) {const item=field(document,`Bend ${index+1} ${key.toUpperCase()}`,point[key],{type:'number',disabled:!editable||place.locks.route});inputs.set(`bend-${index}-${key}`,item.input);row.append(item.label);}
      const remove=button(document,`Remove bend ${index+1}`,'remove-bend',{disabled:!editable||place.locks.route});remove.onclick=()=>act('remove-bend',index);row.append(remove);bends.append(row);
    });
    const addBend=button(document,'Add bend','add-bend',{disabled:!editable||place.locks.route});bends.append(addBend);form.append(bends);
    const reset=button(document,'Reset route','reset-route',{disabled:!editable||place.locks.route});form.append(reset);
    if (geom.label) {add('Label X',geom.label.x,{type:'number'});add('Label Y',geom.label.y,{type:'number'});add('Label width',geom.label.width,{type:'number',min:1});}
    else form.append(button(document,'Position label','position-label',{disabled:!editable}));
  }
  add('Fill',look.appearance.fill,{choices:['surface','accent','success','warning','danger','transparent']});
  add('Stroke',look.appearance.stroke,{choices:['default','accent','muted','danger','none']});
  add('Line style',look.appearance.strokeStyle,{choices:['solid','dashed','dotted']});
  add('Font size',look.appearance.fontSize,{type:'number',min:12,max:48});
  for(const [name,key] of [['Lock position','position'],['Lock size','size'],['Lock route','route']]) {
    if (key==='route' && entry.collection!=='relations') continue;
    if (key!=='route' && !geom.bounds) continue;
    add(name,look.locks[key],{type:'checkbox'});
  }
  const apply=element(document,'button',{type:'submit',className:'de-primary',disabled:!editable},'Apply properties');form.append(apply);root.append(form);
  form.addEventListener('submit',event=>{
    event.preventDefault();if(!editable)return;
    const nextSem=clone(sem),nextGeom=clone(geom),nextLook=clone(look);
    const value=name=>inputs.get(name)?.value;const number=name=>Number(value(name));
    if(entry.collection==='annotations')nextSem.text=value('Label');else nextSem.label=value('Label')|| (entry.collection==='relations'?null:'');
    if(entry.collection==='nodes'){nextSem.description=value('Description')||null;nextSem.kind=value('Semantic role');nextLook.appearance.shape={process:'rectangle',start:'ellipse',end:'ellipse',decision:'diamond','data-store':'cylinder',component:'rounded-rectangle'}[nextSem.kind];}
    if(nextGeom.bounds)for(const [name,key]of[['X','x'],['Y','y'],['Width','width'],['Height','height']])nextGeom.bounds[key]=number(name);
    if(entry.collection==='relations') {
      nextSem.from=value('From');nextSem.to=value('To');nextSem.direction=value('Direction');nextSem.kind=value('Relationship');
      nextGeom.route.strategy=value('Routing');nextGeom.route.from.side=value('Start side');nextGeom.route.to.side=value('End side');
      if(nextGeom.route.mode==='manual')nextGeom.route.points.slice(1,-1).forEach((_,index)=>{
        const original=geom.route.points[index+1],x=number(`bend-${index}-x`),y=number(`bend-${index}-y`);
        if(x===original.x&&y===original.y)return;
        if(nextGeom.route.strategy==='orthogonal')nextGeom.route.points=moveOrthogonalBend(nextGeom.route.points,index+1,x-nextGeom.route.points[index+1].x,y-nextGeom.route.points[index+1].y);
        else nextGeom.route.points[index+1]={x,y};
      });
      if(nextGeom.label)nextGeom.label={x:number('Label X'),y:number('Label Y'),width:number('Label width')};
    }
    nextLook.appearance.fill=value('Fill');nextLook.appearance.stroke=value('Stroke');nextLook.appearance.strokeStyle=value('Line style');nextLook.appearance.fontSize=number('Font size');
    for(const [name,key]of[['Lock position','position'],['Lock size','size'],['Lock route','route']])if(inputs.has(name))nextLook.locks[key]=inputs.get(name).checked;
    submitTransaction(propertyTransaction(bundle,id,{semantic:nextSem,geometry:nextGeom,appearance:nextLook}));
  });
  if(entry.collection!=='relations')parentControl(ids);
  if(['groups','lanes'].includes(entry.collection)) {
    const heading=element(document,'h3',{},'Members');root.append(heading);
    for(const member of entry.value.members)root.append(button(document,labelOf(byId.get(member).value),'select-member',{'data-member':member}));
    if(!entry.value.members.length)root.append(element(document,'p',{className:'de-muted'},'No members. Select objects and choose this parent to add them.'));
    actionRow(['Arrange horizontally…','lane-horizontal'],['Arrange vertically…','lane-vertical'],['Ungroup','ungroup']);
    if(entry.collection==='lanes')actionRow(['Move lane up','lane-up'],['Move lane down','lane-down']);
    root.append(button(document,state.view.collapsedGroups.includes(id)?'Expand contents':'Collapse contents','collapse'));
  }
  actionRow(['Copy','copy'],['Duplicate','duplicate'],['Unlock selection','unlock'],['Delete selection…','delete']);
  root.append(element(document,'p',{className:'de-reference'},`Reference: ${id}`));
  function parentControl(selectedIds) {
    const parents=parentIndex(bundle.document),current=parents.get(selectedIds[0])??'';
    const choices=[['','Diagram root'],...[...bundle.document.groups,...bundle.document.lanes].filter(item=>!selectedIds.includes(item.id)).map(item=>[item.id,item.label])];
    const parent=field(document,'Parent',current,{choices,disabled:!editable});root.append(parent.label);
    const apply=button(document,'Move to parent','reparent',{disabled:!editable});apply.onclick=()=>act('reparent',parent.input.value||null);root.append(apply);
  }
}
