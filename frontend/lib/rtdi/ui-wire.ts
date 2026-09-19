import {z} from 'zod';
import {edgeBatchSchema,edgeRecordSchema} from './wire.ts';

// D published these additive fields in 2085284. Keep E independently testable on
// eababfc until A integrates both branches; all other wire rules stay authoritative.
const provenanceSchema=z.object({
 original_request_id:z.string().min(1).max(120).optional(),
 source_event_id:z.string().min(1).max(120).optional(),
});
export function withoutProvenance<T extends {original_request_id?:string;source_event_id?:string}>(record:T){
 const {original_request_id,source_event_id,...wire}=record;
 return wire;
}
export const uiEdgeRecordSchema=edgeRecordSchema.innerType().extend(provenanceSchema.shape).superRefine((record,ctx)=>{
 const checked=edgeRecordSchema.safeParse(withoutProvenance(record));
 if(!checked.success)for(const issue of checked.error.issues)ctx.addIssue(issue);
});
export const uiEdgeBatchSchema=edgeBatchSchema.innerType().extend({events:z.array(uiEdgeRecordSchema).min(1).max(100)}).superRefine((batch,ctx)=>{
 const checked=edgeBatchSchema.safeParse({...batch,events:batch.events.map(withoutProvenance)});
 if(!checked.success)for(const issue of checked.error.issues)ctx.addIssue(issue);
});
export type UiEdgeRecord=z.infer<typeof uiEdgeRecordSchema>;
