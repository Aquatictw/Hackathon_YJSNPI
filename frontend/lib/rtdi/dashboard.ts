import {z} from 'zod';
import {edgeRecordSchema} from './wire.ts';
const str=z.string();
export const snapshotSchema=z.object({
 run:z.object({run_id:str,tester_id:str,edge_id:str,mode:z.enum(['replay','live','simulation']),lot_id:str.nullable(),wafer_id:str.nullable(),data_quality:str,last_event_at:str}),
 events:z.array(edgeRecordSchema),evidence:z.array(edgeRecordSchema),
 incidents:z.array(z.object({incident_id:str,title:str,status:str,severity:str,first_seen:str,last_seen:str})),
 commands:z.array(z.object({command_id:str,run_id:str,tester_id:str,incident_id:str,kind:str,message:str,status:str,expires_at:str,created_at:str,updated_at:str})),
}).superRefine((s,ctx)=>{
 for(const e of [...s.events,...s.evidence,...s.commands])if(e.run_id!==s.run.run_id||e.tester_id!==s.run.tester_id)ctx.addIssue({code:'custom',message:'後端回應的 run/tester 範圍不一致。'});
});
export type Snapshot=z.infer<typeof snapshotSchema>;
export function parseSnapshot(input:unknown,run:string,tester?:string){const s=snapshotSchema.parse(input);if(s.run.run_id!==run||(tester&&s.run.tester_id!==tester))throw Error('後端回應範圍不符合查詢。');return s;}
export function runUrl(run:string,tester:string,suffix=''){return `/api/v1/runs/${encodeURIComponent(run)}${suffix}?${new URLSearchParams(tester?{tester_id:tester}:{})}`;}
export const commandLabels:Record<string,string>={queued:'後端排隊',edge_received:'Edge 已接收',edge_executed:'Edge 已執行',tester_confirmed:'後端回報機台確認',failed:'執行失敗',expired:'已過期'};
