import json
from pathlib import Path
import html
import argparse
import os
import uuid
import hashlib
def write_report(alerts,path):
    Path(path).parent.mkdir(parents=True,exist_ok=True); Path(path).write_text(json.dumps({"mode":"replay","alert_count":len(alerts),"alerts":[a.__dict__ for a in alerts]},indent=2),encoding="utf-8")

def chart(alert):
    groups=alert.get('site_series') or {alert.get('site','all'):alert.get('series',[])}
    values=[v for seq in groups.values() for v in seq]
    if not values: return ''
    low,high=min(values),max(values)
    if high==low: high=low+max(abs(low)*.01,1e-6)
    span=high-low; low-=span*.1; high+=span*.1
    colors=['#14b8a6','#fb923c','#a78bfa','#38bdf8']
    plots=[]; labels=[]
    for i,(site,seq) in enumerate(sorted(groups.items())):
        color=colors[i%len(colors)]
        points=' '.join('{:.1f},{:.1f}'.format(65+j*610/max(len(seq)-1,1),190-(v-low)/(high-low)*155) for j,v in enumerate(seq))
        plots.append('<polyline fill="none" stroke="'+color+'" stroke-width="2" points="'+points+'"/>')
        labels.append('<span style="color:'+color+'">Site '+html.escape(str(site))+'</span>')
    return '<div class="legend">'+' · '.join(labels)+'</div><svg role="img" aria-label="Measurements by site in arrival order" viewBox="0 0 720 235"><path d="M65 25 V190 H685" fill="none" stroke="#64748b"/>'+''.join(plots)+'<text x="4" y="35">{:.4g}</text><text x="4" y="193">{:.4g}</text><text x="190" y="222">Completed device order within each site →</text></svg>'.format(high,low)

def render_evidence(summary,path):
    e=lambda value:html.escape(str(value))
    wafers=summary.get('wafers',[])
    mode=summary.get('mode','live')
    total=sum(len(w['alerts']) for w in wafers)
    body=['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>grp6 | Test insight</title><style>',
    'body{margin:0;background:#0b1220;color:#e2e8f0;font:16px system-ui}main{max-width:1120px;margin:auto;padding:40px 24px}h1{font-size:38px;margin:12px 0}h2{margin-top:32px}p{line-height:1.6;color:#b8c5d6}.tag{color:#5eead4;font-weight:700;text-transform:uppercase;letter-spacing:2px}.cards{display:flex;gap:16px;flex-wrap:wrap}.card,article{background:#142033;border:1px solid #2a3b52;border-radius:14px;padding:22px;margin:14px 0}.card{flex:1;min-width:180px}.num{font-size:32px;color:#fff}input,select{background:#142033;color:#fff;border:1px solid #51647c;padding:12px;border-radius:7px;margin:5px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #304258}th{color:#94a3b8}summary{cursor:pointer;font-weight:650}svg{max-width:760px;width:100%;margin:12px 0}svg text{fill:#94a3b8;font:12px system-ui}.legend{font-size:13px;margin-top:18px}code{overflow-wrap:anywhere}article small{color:#99aec8}.warning{border-left:4px solid #fb923c;padding-left:16px}.hide{display:none}button{padding:10px;border-radius:6px;cursor:pointer}@media print{body{background:white;color:black}article,.card{background:white}input,select,button{display:none}}',
    '</style><main><div class="tag">grp6 · semiconductor test assistant</div><h1>Evidence before action.</h1>',
    '<p class="warning">Mode: <strong>'+e(mode.upper())+'</strong> · '+e(summary.get('live_integration','SDK events recorded; tester display requires separate confirmation'))+'</p>',
    '<div class="cards"><div class="card"><div class="num">'+str(len(wafers))+'</div>Recorded test groups</div><div class="card"><div class="num">'+str(total)+'</div>Evidence-backed alerts</div><div class="card"><div class="num">6</div>Flow-gated prediction models</div></div>']
    if mode=='replay':
        body.append('<p>Expected development scenarios found: {}/{}. Development normal-check wafers with alerts: {} / {}. Maximum local detector scan: {:.1f} ms. These are replay results, not live acceptance.</p>'.format(summary.get('expected_anomalies_detected'),summary.get('expected_anomaly_wafers'),len(summary.get('heldout_normal_wafers_alerted',[])),len(summary.get('heldout_normal_wafers',[])),summary.get('max_scan_ms',0)))
    body.append('<h2>Prediction validation</h2><p>Five folds split by wafer; feature selection is fitted inside each fold. Inputs are restricted by actual flow execution before each request. Values below use CSV units.</p><table><tr><th>Request</th><th>Held-out MAE</th><th>Constant baseline MAE</th><th>Devices</th></tr>')
    for stage,m in summary.get('validation',{}).get('metrics',{}).items():
        body.append('<tr><td>'+e(stage)+'</td><td>{:.6f}</td><td>{:.6f}</td><td>{}</td></tr>'.format(m['mae'],m['baseline_mae'],m['n']))
    body.append('</table><h2>Test groups / wafer overview</h2><p>Unknown wafer IDs remain unknown. Counts describe recorded devices, not a complete raw measurement export.</p><table><tr><th>Wafer / scope</th><th>Devices</th><th>Yield</th><th>Reference label</th><th>Observed alerts</th></tr>')
    for w in wafers:
        body.append('<tr><td>'+e(w['wafer'])+'</td><td>'+e(w.get('devices','unknown'))+'</td><td>'+('{:.1%}'.format(w['yield']) if w.get('yield') is not None else '—')+'</td><td>'+e(w.get('expected','not supplied'))+'</td><td>'+e(', '.join(a['kind'] for a in w['alerts']) or 'none recorded')+'</td></tr>')
    body.append("</table>")
    if summary.get('predictions'):
        body.append('<h2>Recorded predictions by site</h2><p>Values are in unverified CSV units. Coverage measures available model inputs, not accuracy. A returned action requires separate tester receipt evidence.</p><table><tr><th>Scope / request</th><th>Stage / site</th><th>Prediction</th><th>Actual</th><th>Absolute error</th><th>Coverage</th><th>Latency ms</th><th>Delivery</th></tr>')
        for p in summary['predictions']:
            body.append('<tr>'+''.join('<td>'+e(value if value is not None else 'unknown')+'</td>' for value in [
                p.get('device_id') or p.get('request_id'), str(p.get('stage'))+' / '+str(p.get('site')),
                p.get('predicted'),p.get('actual'),p.get('absolute_error'),p.get('coverage'),p.get('latency_ms'),p.get('status')])+'</tr>')
        body.append("</table>")
    if summary.get('errors'):
        body.append('<h2>Recorded errors / data gaps</h2><ul>'+''.join('<li>'+e(x)+'</li>' for x in summary['errors'])+'</ul>')
    body.append('<h2>Investigate alerts</h2><input id="search" placeholder="Search wafer, test, site, or alert" aria-label="Search alerts"><button onclick="window.print()">Print / save PDF</button>')
    for w in wafers:
        for a in w['alerts']:
            body.append('<article><details open><summary>Wafer '+e(w['wafer'])+' · '+e(a['kind'].replace('_',' '))+' · device '+e(a['completed_devices'])+'</summary><p>'+e(a['message'])+'</p><small>Test: <code>'+e(a['test'])+'</code> · Site '+e(a['site'])+'</small>'+chart(a)+'<p>Observed: '+e(a['observed'])+' · Reference: '+e(a['reference'])+'</p><p><strong>Suggested investigation:</strong> '+e(a['suggestion'])+'</p><p>Delivery: '+e('replay only — no tester message sent' if mode=='replay' else 'see action_message events; queued does not prove tester display')+'</p></details></article>')
    body.append('<h2>Limits and provenance</h2><ul>')
    if summary.get("evidence_sha256"):
        body.append("<li>Source JSONL SHA256: <code>"+e(summary["evidence_sha256"])+"</code></li>")
    for digest in summary.get("model_hashes",[]):
        body.append("<li>Model SHA256: <code>"+e(digest)+"</code></li>")
    for limitation in summary.get('limitations',[]): body.append('<li>'+e(limitation)+'</li>')
    body.append('</ul><p>Detailed numbers, timestamps, action states, and raw plot series remain in the adjacent JSON/JSONL evidence files. Alerts suggest checks; they do not establish root cause.</p></main><script>document.getElementById("search").addEventListener("input",function(){let q=this.value.toLowerCase();document.querySelectorAll("article").forEach(a=>a.classList.toggle("hide",!a.textContent.toLowerCase().includes(q)))})</script></html>')
    Path(path).parent.mkdir(parents=True,exist_ok=True)
    destination = Path(path)
    temporary = destination.with_name(destination.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        temporary.write_text(''.join(body),encoding='utf-8')
        os.replace(str(temporary),str(destination))
    finally:
        if temporary.exists(): temporary.unlink()

def from_log(log,path):
    wafers={}; errors=[]; predictions={}; measurements=0; seen={}; contexts={}
    default_run="legacy"
    sources=set(); model_hashes=set(); queued=0; messages=0; returned=0
    raw=Path(log).read_bytes()
    for number,line in enumerate(raw.decode("utf-8").splitlines(),1):
        if not line.strip(): continue
        try:
            event=json.loads(line)
            if not isinstance(event,dict): raise ValueError('expected JSON object')
        except ValueError:
            errors.append('Malformed JSONL line {}'.format(number)); continue
        event_id=event.get('event_id')
        if event_id and event_id in seen:
            if seen[event_id]!=event: errors.append('Conflicting duplicate event '+event_id)
            continue
        if event_id: seen[event_id]=event
        sources.add(event.get('source_mode',event.get('mode','legacy source unverified')))
        if event.get('model_sha256'): model_hashes.add(event['model_sha256'])
        kind=event.get('kind'); tester=str(event.get('tester','unknown tester'))
        if kind=="monitor_start":
            contexts.clear()
            default_run=event.get("run_id","legacy-{}".format(number))
        context=contexts.setdefault(tester,dict(run=default_run,lot="",wafer=""))
        if kind=='lot_start': context.update(lot=event.get('lot',''),wafer='')
        for field,source in [('run','run_id'),('lot','lot'),('wafer','wafer')]:
            if source in event: context[field]=str(event[source] or '')
        key=(context['run'],tester,context['lot'],context['wafer'])
        if kind in ('test_start','device_end','run_summary','alert','prediction_request'):
            group=wafers.setdefault(key,{'wafer':' / '.join([tester,context['lot'] or 'unknown lot',context['wafer'] or 'unknown wafer']),
                'wafer_id':context['wafer'],'run_id':context['run'],'devices':0,'good':0,'known_bins':0,'yield':None,'alerts':[],'summary':None})
        if kind=='alert': group['alerts'].append(event['alert'])
        elif kind=='device_end':
            group['devices']+=1
            if isinstance(event.get('sbin'),int) and 1<=event['sbin']<=32:
                group['known_bins']+=1; group['good']+=event['sbin']==1
            group['yield']=group['good']/group['devices'] if group['devices']==group['known_bins'] else None
        elif kind=='run_summary':
            group["summary"]={"devices":event["completed_devices"],"yield":event.get("yield_fraction")}
        elif kind and kind.endswith('_error'): errors.append(kind+': '+str(event.get('error','unknown')))
        elif kind=='prediction_request':
            queued+=event.get('status')=='response_queued'
            sites=set(event.get('coverage',{}))|set(event.get('predictions',{}))
            for site in sorted(sites):
                pid=event.get('prediction_ids',{}).get(site,'legacy:{}:{}'.format(number,site))
                predictions[pid]=dict(request_id=event.get('request_id','legacy line {}'.format(number)),
                    scope=key,
                    device_id=event.get('device_ids',{}).get(site),stage=event['stage'],site=site,
                    predicted=event.get('predictions',{}).get(site),actual=None,absolute_error=None,
                    coverage=event.get('coverage',{}).get(site),latency_ms=event.get('latency_ms'),status=event.get('status'))
        elif kind=='prediction_actual':
            prior=predictions.get(event.get('prediction_id'))
            if prior is None: errors.append('Unmatched actual '+str(event.get('prediction_id')))
            elif (prior["scope"]!=key or prior["request_id"]!=event.get("request_id")
                  or prior["site"]!=str(event.get("site")) or prior["stage"]!=event.get("stage")
                  or prior["device_id"]!=event.get("device_id")):
                errors.append("Actual scope mismatch "+str(event.get("prediction_id")))
            else: prior.update(actual=event.get('actual'),absolute_error=event.get('absolute_error'))
        elif kind=='measurement': measurements+=1
        elif kind=='action_message': messages+=1
        elif kind=='production_action_response': returned+=1
    for group in wafers.values():
        recorded_summary=group.pop("summary")
        if recorded_summary and not group["devices"]:
            group.update(recorded_summary)
        elif recorded_summary and recorded_summary["devices"]!=group["devices"]:
            errors.append("Device count differs from detector summary: "+group["wafer"])
    base=Path(__file__).parent/'artifacts'
    summary={'mode':'recorded evidence: '+', '.join(sorted(sources)), 'wafers':list(wafers.values()),
      "evidence_sha256":hashlib.sha256(raw).hexdigest(),
      'predictions':list(predictions.values()),'errors':errors,'model_hashes':sorted(model_hashes),
      'validation':json.loads((base/'validation.json').read_text()),
      'live_integration':'{} sampled measurements; {} queued prediction responses; {} queued messages; {} production responses; {} errors. Saved evidence is not a current health check. Tester receipt not automatically confirmed.'.format(measurements,queued,messages,returned,len(errors)),
      'limitations':['ActionManager queueing/return does not confirm tester display.',
        'Physical units remain unverified. Actuals require matching prediction ID and device/request/run scope.',
        'Raw measurement export is sampled; alert windows and final targets are separate evidence.',
        'Legacy events without source provenance remain unverified; unknown wafer/device IDs are not invented.']}
    render_evidence(summary,path)
    return summary

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('log');p.add_argument('--output',default='results/live/report.html');a=p.parse_args();from_log(a.log,a.output)
