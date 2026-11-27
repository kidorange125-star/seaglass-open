import * as L from '../../src/client/db/logic.ts';
let ok=0,bad=0; const t=(n,c,x='')=>{ c?ok++:(bad++,console.log('FAIL',n,x)) };
const mk=(id,title,props,extra={})=>({id,title,props:JSON.stringify(props),position:1,created_at:Date.parse('2026-01-05'),updated_at:Date.parse('2026-01-06'),is_template:0,...extra});
const schema={properties:[
 {id:'title',name:'Name',type:'title'},
 {id:'price',name:'Price',type:'number'},{id:'qty',name:'Qty',type:'number'},
 {id:'st',name:'Status',type:'status',options:[{id:'a',name:'Todo',color:'gray'},{id:'b',name:'Done',color:'green'}]},
 {id:'tg',name:'Tags',type:'multi_select',options:[{id:'x',name:'urgent',color:'red'},{id:'y',name:'home',color:'blue'}]},
 {id:'due',name:'Due',type:'date'},{id:'ok',name:'Ok',type:'checkbox'},
 {id:'tot',name:'Total',type:'formula',formula:'prop("Price") * prop("Qty")'},
 {id:'rel',name:'Items',type:'relation',relation:{database_id:'DB2'}},
 {id:'ru',name:'Sum',type:'rollup',rollup:{relation:'rel',property:'amt',fn:'sum'}},
 {id:'cnt',name:'Count',type:'rollup',rollup:{relation:'rel',property:'amt',fn:'count'}},
],views:[]};
const sub={properties:[{id:'title',name:'Name',type:'title'},{id:'amt',name:'Amount',type:'number'}],views:[]};
const subRows=[mk('s1','one',{amt:10}),mk('s2','two',{amt:5.5}),mk('s3','three',{amt:100})];
const ctx={schema,related:new Map([['DB2',{schema:sub,rows:subRows}]])};
const r1=mk('r1','Alpha',{price:4,qty:3,st:'b',tg:['x'],due:{start:'2026-03-10'},ok:true,rel:['s1','s2']});
const r2=mk('r2','beta',{price:2.5,qty:2,st:'a',tg:['x','y'],due:{start:'2026-02-01'},ok:false,rel:['s3']});
const r3=mk('r3','Gamma',{price:9,st:'a'});
const rows=[r1,r2,r3];
const F=(s,r=r1)=>L.evalFormula(s,r,ctx);
t('mult',F('prop("Price") * prop("Qty")')===12,F('prop("Price") * prop("Qty")'));
t('prec',F('2 + 3 * 4')===14); t('paren',F('(2+3)*4')===20); t('pow',F('2^3^2')===512,F('2^3^2')); t('neg',F('-3 + 5')===2);
t('if',F('if(prop("Price") > 3, "big", "small")')==='big'); t('if2',F('if(prop("Price") > 3, "big", "small")',r2)==='small');
t('concat',F('concat(prop("Name"), " - ", prop("Status"))')==='Alpha - Done',F('concat(prop("Name"), " - ", prop("Status"))'));
t('+str',F('"a" + 1')==='a1'); t('round',F('round(10/3, 2)')===3.33); t('div0',F('1/0')===null);
t('date add',F('dateAdd(prop("Due"), 5, "days")')==='2026-03-15',F('dateAdd(prop("Due"), 5, "days")'));
t('date between',F('dateBetween(prop("Due"), "2026-03-01", "days")')===9,F('dateBetween(prop("Due"), "2026-03-01", "days")'));
t('empty()',F('empty(prop("Qty"))',r3)===true); t('contains tags',F('contains(prop("Tags"), "urgent")')===true);
t('length',F('length(prop("Name"))')===5); t('upper',F('upper("ab")')==='AB'); t('ifs',F('ifs(false,"a",true,"b","c")')==='b');
t('and/or',F('prop("Ok") && prop("Price") > 1')===true && F('prop("Ok") || false',r2)===false);
t('bad prop',String(F('prop("Nope")')).startsWith('⚠'),F('prop("Nope")')); t('syntax',String(F('1 +')).startsWith('⚠'),F('1 +')); t('unknown fn',String(F('foo(1)')).startsWith('⚠'));
t('no eval/injection',String(F('constructor')).startsWith('⚠')&&String(F('alert(1)')).startsWith('⚠'));
t('formula prop',L.getValue(r1,schema.properties[7],ctx)===12);
t('rollup sum',L.getValue(r1,schema.properties[9],ctx)===15.5,L.getValue(r1,schema.properties[9],ctx)); t('rollup count',L.getValue(r2,schema.properties[10],ctx)===1);
t('relation display',L.display(schema.properties[8],['s1','s2'],ctx)==='one, two',L.display(schema.properties[8],['s1','s2'],ctx));
const V=(o)=>({id:'v',name:'v',type:'table',filters:[],filter_mode:'and',sorts:[],hidden:[],...o});
const names=(a)=>a.map(r=>r.title).join(',');
t('default order',names(L.applyView(rows,V({}),ctx))==='Alpha,beta,Gamma');
t('sort num asc, empty last',names(L.applyView(rows,V({sorts:[{prop:'qty',dir:'asc'}]}),ctx))==='beta,Alpha,Gamma',names(L.applyView(rows,V({sorts:[{prop:'qty',dir:'asc'}]}),ctx)));
t('sort num desc, empty last',names(L.applyView(rows,V({sorts:[{prop:'qty',dir:'desc'}]}),ctx))==='Alpha,beta,Gamma');
t('sort text ci',names(L.applyView(rows,V({sorts:[{prop:'title',dir:'asc'}]}),ctx))==='Alpha,beta,Gamma');
t('sort date',names(L.applyView(rows,V({sorts:[{prop:'due',dir:'asc'}]}),ctx))==='beta,Alpha,Gamma');
t('sort status by option order',names(L.applyView(rows,V({sorts:[{prop:'st',dir:'desc'}]}),ctx))==='Alpha,beta,Gamma');
t('filter status is',names(L.applyView(rows,V({filters:[{id:'1',prop:'st',op:'is',value:'a'}]}),ctx))==='beta,Gamma');
t('filter num gt',names(L.applyView(rows,V({filters:[{id:'1',prop:'price',op:'gt',value:3}]}),ctx))==='Alpha,Gamma');
t('filter multi contains',names(L.applyView(rows,V({filters:[{id:'1',prop:'tg',op:'contains',value:'y'}]}),ctx))==='beta');
t('filter text contains',names(L.applyView(rows,V({filters:[{id:'1',prop:'title',op:'contains',value:'AL'}]}),ctx))==='Alpha');
t('filter date before',names(L.applyView(rows,V({filters:[{id:'1',prop:'due',op:'before',value:'2026-03-01'}]}),ctx))==='beta');
t('filter empty',names(L.applyView(rows,V({filters:[{id:'1',prop:'due',op:'empty'}]}),ctx))==='Gamma');
t('filter checked',names(L.applyView(rows,V({filters:[{id:'1',prop:'ok',op:'checked'}]}),ctx))==='Alpha');
t('filter OR',names(L.applyView(rows,V({filter_mode:'or',filters:[{id:'1',prop:'ok',op:'checked'},{id:'2',prop:'st',op:'is',value:'a'}]}),ctx))==='Alpha,beta,Gamma');
t('filter AND',names(L.applyView(rows,V({filters:[{id:'1',prop:'st',op:'is',value:'a'},{id:'2',prop:'price',op:'gt',value:3}]}),ctx))==='Gamma');
t('filter on formula',names(L.applyView(rows,V({filters:[{id:'1',prop:'tot',op:'gte',value:12}]}),ctx))==='Alpha');
t('search',names(L.applyView(rows,V({}),ctx,'urgent'))==='Alpha,beta'||names(L.applyView(rows,V({}),ctx,'urgent'))==='', names(L.applyView(rows,V({}),ctx,'gam')));
t('search title',names(L.applyView(rows,V({}),ctx,'gam'))==='Gamma');
t('templates hidden',names(L.applyView([...rows,mk('t','tpl',{},{is_template:1})],V({}),ctx))==='Alpha,beta,Gamma');
const g=L.groupRows(rows,schema.properties[3],ctx);
t('group status',g.map(x=>x.label+':'+x.rows.length).join('|')==='Todo:2|Done:1',g.map(x=>x.label+':'+x.rows.length).join('|'));
const g2=L.groupRows(rows,schema.properties[4],ctx); t('group multi (row in 2 groups)',g2.map(x=>x.label+':'+x.rows.length).join('|')==='urgent:2|home:1|No tags:1',g2.map(x=>x.label+':'+x.rows.length).join('|'));
t('schema default',L.parseSchema(null).properties.length===4 && L.parseSchema('garbage').views.length===1);
t('number fmt',L.fmtNumber(1234.5,'dollar')==='$1,234.5' && L.fmtNumber(50,'percent')==='50%');
console.log(`${ok} passed, ${bad} failed`);
