import {z} from 'zod';
import {canonicalJson} from './wire.ts';
import {uiEdgeRecordSchema} from './ui-wire.ts';
import {commandStatuses,type CommandStatus} from './command-contract.ts';
const str=z.string();
export const snapshotSchema=z.object({
 run:z.object({run_id:str,tester_id:str,edge_id:str,mode:z.enum(['replay','live','simulation']),lot_id:str.nullable(),wafer_id:str.nullable(),data_quality:str,last_event_at:str}),
 events:z.array(uiEdgeRecordSchema),evidence:z.array(uiEdgeRecordSchema),
 incidents:z.array(z.object({incident_id:str,title:str,status:str,severity:str,first_seen:str,last_seen:str})),
 commands:z.array(z.object({command_id:str,run_id:str,tester_id:str,incident_id:str,kind:str,message:str,status:z.enum(commandStatuses),expires_at:str,created_at:str,updated_at:str,tester_receipt_id:z.string().min(1).nullable().optional()})),
}).superRefine((s,ctx)=>{
 const seen=new Map<string,string>();
 for(const e of [...s.events,...s.evidence]){const key=JSON.stringify([e.run_id,e.tester_id,e.event_id]);const content=canonicalJson(e);if(seen.has(key)&&seen.get(key)!==content)ctx.addIssue({code:'custom',message:'相同事件 ID 的內容衝突。'});seen.set(key,content);}
 for(const e of [...s.events,...s.evidence,...s.commands])if(e.run_id!==s.run.run_id||e.tester_id!==s.run.tester_id)ctx.addIssue({code:'custom',message:'後端回應的 run/tester 範圍不一致。'});
});
export type Snapshot=z.infer<typeof snapshotSchema>;
export function parseSnapshot(input:unknown,run:string,tester?:string){const s=snapshotSchema.parse(input);if(s.run.run_id!==run||(tester&&s.run.tester_id!==tester))throw Error('後端回應範圍不符合查詢。');return s;}
export function runUrl(run:string,tester:string,suffix=''){return `/api/v1/runs/${encodeURIComponent(run)}${suffix}?${new URLSearchParams(tester?{tester_id:tester}:{})}`;}
export const commandLabels:Record<CommandStatus,string>={queued:'後端排隊',received:'Edge 已接收 · 機台未確認',queued_to_tester:'已排入機台訊息佇列 · 機台未確認',tester_confirmed:'後端回報機台確認',rejected:'已拒絕',failed:'處理失敗',expired:'已過期'};
