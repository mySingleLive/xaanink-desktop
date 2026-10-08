"""One-time import from the recorded Git commit; never called by build or runtime."""
import argparse, hashlib, json, pathlib, subprocess
parser=argparse.ArgumentParser();parser.add_argument('source');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]; source=pathlib.Path(args.source).resolve()
manifest=json.loads((root/'docs/reuse-manifest.json').read_text()); commit=manifest['sourceCommit']
items=json.loads((root/'docs/migration-map.json').read_text())
files=subprocess.check_output(['git','ls-tree','-r','--name-only',commit],cwd=source,text=True).splitlines()
excluded={f['source'] for f in manifest['files'] if f['disposition']=='excluded-platform'}
selected={p:p for p in files if p.startswith(('src/components/','src/hooks/','src/stores/','src/lib/','src/types/','public/','prisma/migrations/')) and p not in excluded}
for p in ['prisma/schema.prisma','prisma/seed-templates.ts','src/app/globals.css','src/app/providers.tsx','postcss.config.mjs']:
 if p in files:selected[p]=p
for r in items['routes']:
 if r['disposition']!='excluded-platform':selected[r['path']]=r['local']
# Import sibling helpers used by retained routes, not only route entry files.
retained_routes=[r['path'] for r in items['routes'] if r['disposition']!='excluded-platform']
for p in files:
 if p.startswith('src/app/api/') and p.endswith('.ts') and not p.endswith('/route.ts') and any(r.startswith(str(pathlib.PurePosixPath(p).parent)+'/') for r in retained_routes):selected[p]='desktop/handlers/'+p.removeprefix('src/app/api/')
imported=[]
for original,destination in sorted(selected.items()):
 out=root/destination
 if out.exists():raise SystemExit(f'Refusing to overwrite {destination}')
 data=subprocess.check_output(['git','show',f'{commit}:{original}'],cwd=source)
 out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(data)
 imported.append({'source':original,'destination':destination,'sha256':hashlib.sha256(data).hexdigest(),'status':'imported-unmodified'})
(root/'docs/imported-source.json').write_text(json.dumps({'sourceCommit':commit,'files':imported},ensure_ascii=False,indent=2)+'\n')
by_source={f['source']:f for f in imported}
for f in manifest['files']:
 if f['source'] in by_source:
  assert f['sha256']==by_source[f['source']]['sha256'], f['source']
  f['status']='imported-unmodified'
(root/'docs/reuse-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(f'Imported {len(imported)} frozen source files; no parent files modified.')
