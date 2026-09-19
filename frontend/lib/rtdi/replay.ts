import { z } from "zod";
const numeric=z.number().finite();
export const alertKinds=["site_imbalance","low_yield","mean_drift_up","mean_drift_down","spread_up","spread_down"] as const;
export const alertNames:Record<string,string>={normal:"正常標籤",site_imbalance:"Site 不平衡",low_yield:"低良率",mean_drift_up:"均值上升",mean_drift_down:"均值下降",spread_up:"標準差上升",spread_down:"標準差下降"};
export const replayAlertSchema=z.object({
 kind:z.enum(alertKinds),message:z.string().max(4000),test:z.string().max(1000),site:z.string().max(80),
 completed_devices:z.number().int().nonnegative(),observed:numeric,reference:numeric,score:numeric,
 series:z.array(numeric).max(5000),site_series:z.record(z.string().max(80),z.array(numeric).max(5000)),
 baseline:z.object({mean:numeric,sd:numeric.nonnegative(),thresholds:z.record(numeric).optional()}).nullable(),
 suggestion:z.string().max(4000),family:z.string().max(500).optional(),family_score_over_threshold:numeric.optional(),family_persistence_scans:z.number().int().nonnegative().optional(),
}).refine(a=>Object.keys(a.site_series).length<=32,{message:"Too many sites"});
const metrics=z.object({n:z.number().int().nonnegative(),mae:numeric.nonnegative(),rmse:numeric.nonnegative(),worst_error:numeric.nonnegative(),baseline_mae:numeric.nonnegative()});
export const replaySchema=z.object({
 mode:z.literal("replay"),live_integration:z.string().max(1000),
 wafers:z.array(z.object({wafer:z.union([z.string().min(1).max(80),z.number().int()]).transform(String),devices:z.number().int().nonnegative(),yield:numeric.min(0).max(1),expected:z.string().max(100),expected_first_device:z.number().int().nonnegative().nullable(),alerts:z.array(replayAlertSchema).max(300)})).min(1).max(500),
 validation:z.object({mode:z.string().max(200).optional(),units:z.string().max(1000).optional(),metrics:z.record(metrics)}),
 limitations:z.array(z.string().max(4000)).max(100),
 max_scan_ms:numeric.nonnegative().optional(),max_model_ms:numeric.nonnegative().optional(),
}).superRefine((r,ctx)=>{
 if(new Set(r.wafers.map(w=>w.wafer)).size!==r.wafers.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:"重複 wafer ID，無法安全彙總。",path:['wafers']});
 for(const [i,w] of r.wafers.entries())if(w.alerts.some(a=>a.completed_devices>w.devices))ctx.addIssue({code:z.ZodIssueCode.custom,message:"偵測位置超過完成數。",path:['wafers',i]});
});
export type Replay=z.infer<typeof replaySchema>;
export type ReplayAlert=z.infer<typeof replayAlertSchema>;
export function parseReplay(input:unknown):Replay{return replaySchema.parse(input);}
export function replayTotals(data:Replay){
 return {devices:data.wafers.reduce((n,w)=>n+w.devices,0),alerts:data.wafers.reduce((n,w)=>n+w.alerts.length,0),alertedWafers:data.wafers.filter(w=>w.alerts.length>0).length};
}
// Presentation grouping only: never infer anomaly, normality, or detector performance.
export function waferState(w:Replay['wafers'][number]):"alert"|"quiet"{
 return w.alerts.length?'alert':'quiet';
}
export function formatObservation(a:ReplayAlert,value:number){return a.kind==='low_yield'?`${(value*100).toFixed(1)}%`:value.toFixed(4);}
export function replayChart(a:ReplayAlert){
 const siteEntries=Object.entries(a.site_series).filter(([,v])=>v.length);
 // Site-series values are raw per-site measurements; low yield's series is cumulative yield.
 return a.kind==='low_yield'?[{name:'累積良率',values:a.series}]:siteEntries.length?siteEntries.map(([site,values])=>({name:`Site ${site}`,values})):[{name:a.site==='all'?'觀測序列':`Site ${a.site}`,values:a.series}];
}
export function investigationText(wafer:string,a:ReplayAlert){
 return `重播證據 · W${wafer}\n異常：${alertNames[a.kind]}\nSite：${a.site}\n測項：${a.test}\n偵測位置：完成 ${a.completed_devices} 顆 device 後\n觀測：${formatObservation(a,a.observed)}；參考：${formatObservation(a,a.reference)}\n偵測分數：${a.score.toFixed(3)}（不是機率）\n\n原始訊息：${a.message}\n建議下一步：${a.suggestion}\n\n限制：這是歷史資料重播；序列沒有事件時間戳。物理單位尚未確認，機台接收狀態也未確認。此摘要由資料欄位整理，非 LLM 生成。`;
}
