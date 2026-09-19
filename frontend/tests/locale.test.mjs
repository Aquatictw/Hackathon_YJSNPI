import test from 'node:test';
import assert from 'node:assert/strict';
import { translate } from '../lib/rtdi/locale.ts';
import { zhTW } from '../lib/rtdi/locale-zh-TW.ts';
import { tourSteps } from '../lib/rtdi/tour-steps.ts';
import { runToolInvestigation } from '../lib/rtdi/agent.ts';

test('locale interpolation preserves identifiers and unknown source strings', () => {
  assert.equal(translate('en', 'Site {0}', 'EV-001'), 'Site EV-001');
  assert.match(translate('zh-TW', 'Site {0}', 'EV-001'), /EV-001/);
  for (const source of ['raw measurement 42.35', 'gpt-5.6-sol', 'EV-001', 'Original saved answer'])
    assert.equal(translate('zh-TW', source), source);
  assert.equal(translate('zh-TW', 'Yield'), '良率');
  assert.ok(Object.keys(zhTW).length > 500);
});

test('all guide explanations and previews have Traditional Chinese translations', () => {
  for (const step of tourSteps) {
    for (const key of ['chapter', 'title', 'body', 'detail'])
      if (step[key]) assert.ok(zhTW[step[key]], `${step.id}: ${key}`);
    if (step.preview) for (const text of [step.preview.label, ...step.preview.rows.flat()])
      assert.ok(zhTW[text], text);
  }
});

for (const topic of ['knowledge', 'analysis']) test(`${topic} uses medium reasoning and Taiwan language without network`, async () => {
  let calls = 0;
  const result = await runToolInvestigation({apiKey:'synthetic',model:'gpt-5.6-sol',topic,language:'zh-TW',question:'Explain',history:[],
    scope: topic === 'analysis' ? {run_id:'r',incident_id:'i'} : null,
    executeTool: async () => ({output:{observed:42.35},evidence_ids:['EV-001']}),
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.reasoning,{effort:'medium'});
      assert.equal(body.model,'gpt-5.6-sol');
      assert.match(body.instructions,/Taiwan zh-TW/);
      assert.match(body.instructions,/資料, 元件, 晶圓 and 良率/);
      if (topic === 'analysis' && calls++ === 0) return Response.json({status:'completed',output:[{type:'function_call',name:'get_incident_evidence',arguments:'{"run_id":"r","incident_id":"i"}',call_id:'c'}]});
      return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:topic === 'knowledge' ? '晶圓包含多個晶粒。[KB-fundamentals]' : '記錄中的觀測值為 42.35。[EV-001]'}]}]});
    }});
  assert.match(result.answer,topic === 'knowledge' ? /晶圓/ : /42.35.*EV-001/);
});
