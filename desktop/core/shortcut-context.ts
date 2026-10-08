type Clause=Record<string,boolean>
const merge=(a:Clause,b:Clause):Clause|null=>Object.entries(a).some(([key,value])=>Object.hasOwn(b,key)&&b[key]!==value)?null:{...a,...b}
const and=(a:Clause[],b:Clause[])=>a.length*b.length>64?[{}]:a.flatMap(x=>b.flatMap(y=>{const both=merge(x,y);return both?[both]:[]}))
/** Prove only boolean when-expressions. Unsupported comparisons/regexes and
 * oversized expressions stay conservatively overlapping, never guess disjoint. */
function alternatives(expression:string|null):Clause[]{
 if(!expression)return[{}]
 const tokens=expression.match(/&&|\|\||!|\(|\)|[\w.$-]+/g)??[]
 if(tokens.join("")!==expression.replace(/\s/g,"")||tokens.length>128)return[{}]
 let at=0
 type Node={key:string}|{not:Node}|{op:"&&"|"||";left:Node;right:Node}
 const atom=():Node=>{const token=tokens[at++];if(token==="!")return{not:atom()};if(token==="("){const result=or();if(tokens[at++]!==")")throw Error();return result}if(!token||!/^[$\w][\w.$-]*$/.test(token))throw Error();return{key:token}}
 const conjunction=():Node=>{let node=atom();while(tokens[at]==="&&"){at++;node={op:"&&",left:node,right:atom()}}return node}
 const or=():Node=>{let node=conjunction();while(tokens[at]==="||"){at++;node={op:"||",left:node,right:conjunction()}}return node}
 const expand=(node:Node,negative=false):Clause[]=>{
  if("key"in node)return node.key==="true"||node.key==="false"?((node.key==="true")!==negative?[{}]:[]):[{[node.key]:!negative}]
  if("not"in node)return expand(node.not,!negative)
  const left=expand(node.left,negative),right=expand(node.right,negative)
  return (node.op==="&&")!==negative?and(left,right):left.length+right.length>64?[{}]:[...left,...right]
 }
 try{const node=or();return at===tokens.length?expand(node):[{}]}catch{return[{}]}
}
/** Arguments variants are guarded by the OR of their registered when clauses
 * in the installed editor target. Ordinary actions may have broader command
 * palette preconditions, so their key-specific whens cannot prove exclusion. */
export function commandContextsOverlap(a:{contexts?:Clause},b:{contexts?:Clause}):boolean{
 const contexts=(value:typeof a):Clause[]=>{
  const row=value as typeof a&{monacoArgs?:unknown;monacoBindings?:{when:string|null}[]}
  const own:Clause=Object.fromEntries(Object.entries(row.contexts??{}).map(([key,value])=>[`desktop:${key}`,value]))
  const native=Object.hasOwn(row,"monacoArgs")&&row.monacoBindings?.length?row.monacoBindings.flatMap(binding=>alternatives(binding.when)):[{}]
  return and([own],native)
 }
 return and(contexts(a),contexts(b)).length>0
}
