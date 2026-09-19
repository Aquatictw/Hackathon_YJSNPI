import test from 'node:test';
import assert from 'node:assert/strict';
import { runToolInvestigation } from '../lib/rtdi/agent.ts';
import { knowledgeSources, localKnowledgePrompt } from '../lib/rtdi/local-knowledge.ts';

const answer = text => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const tool = { status: 'completed', output: [{ type: 'function_call', name: 'get_incident_evidence', arguments: '{"run_id":"r","incident_id":"i"}', call_id: 'c' }] };
function input(responses, overrides = {}) {
  return { apiKey: 'synthetic', model: 'synthetic', topic: 'knowledge', language: 'en', question: 'What is a wafer?', scope: null, history: [],
    executeTool: async () => { throw Error('Knowledge must not read run data'); },
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.ok(responses.length, 'No additional translation or classification requests');
      return Response.json(responses.shift());
    }, ...overrides };
}

test('general Q&A uses bundled references in one model call with no run or web tools', async () => {
  let requests = 0;
  const result = await runToolInvestigation(input([], { fetcher: async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const request = JSON.parse(options.body);
    assert.deepEqual(request.tools, []); assert.equal(request.tool_choice, 'none');
    assert.match(request.instructions, /LOCAL REFERENCE PACK/);
    assert.match(request.instructions, /Response language: English/);
    assert.match(request.instructions, /No run data is available/);
    assert.match(request.instructions, /Do not browse the web/);
    assert.match(request.input.at(-1).content, /Selected scope: null/);
    return Response.json(answer('A wafer contains many dies. [KB-fundamentals]'));
  } }));
  assert.equal(requests, 1); assert.deepEqual(result.evidence_ids, []); assert.deepEqual(result.tool_trace, []);
  assert.deepEqual(result.knowledge_sources.map(source => source.id), ['KB-fundamentals']);
});

test('the selected response language overrides question and conversation language', async () => {
  const result = await runToolInvestigation(input([], { language: 'zh-TW', question: 'What is a wafer?',
    history: [{ role: 'assistant', content: 'Previous English answer.' }],
    fetcher: async (_url, options) => {
      assert.match(JSON.parse(options.body).instructions, /Response language: Traditional Chinese/);
      return Response.json(answer('晶圓上包含多個晶粒。[KB-fundamentals]'));
    } }));
  assert.match(result.answer, /晶圓/);
  await assert.rejects(runToolInvestigation(input([answer('晶圓。[KB-fundamentals]')])), /must be in English/);
});

test('general Q&A rejects fabricated evidence, unknown documents and uncited answers', async () => {
  for (const text of ['This wafer failed. [EV-fake]', 'A fact. [KB-invented]', 'An uncited explanation.'])
    await assert.rejects(runToolInvestigation(input([answer(text)])), /outside the verified|requires a local reference/);
  await assert.rejects(runToolInvestigation(input([tool])), /cannot execute tools/);
});

test('analysis can cite local concepts but still needs verified run evidence', async () => {
  const result = await runToolInvestigation(input([tool, answer('The stored shift is observed [EV-1]. A shift is not a proven cause [KB-statistics].')], {
    topic: 'analysis', scope: { run_id: 'r', incident_id: 'i' },
    executeTool: async () => ({ output: { source_mode: 'replay', observed: 1.2 }, evidence_ids: ['EV-1'] }),
  }));
  assert.deepEqual(result.evidence_ids, ['EV-1']);
  assert.deepEqual(result.knowledge_sources.map(source => source.id), ['KB-statistics']);
  await assert.rejects(runToolInvestigation(input([answer('A shift is a change [KB-statistics].')], { topic: 'analysis', scope: { run_id: 'r' } })), /verified tool/);
  await assert.rejects(runToolInvestigation(input([tool, answer('A shift is a change [KB-statistics].')], {
    topic: 'analysis', scope: { run_id: 'r' }, executeTool: async () => ({ output: {}, evidence_ids: ['EV-1'] }),
  })), /omitted verified evidence/);
});

test('local notes have unique citations, provenance and bounded prompt size without wafer answer labels', () => {
  assert.equal(new Set(knowledgeSources.map(source => source.id)).size, knowledgeSources.length);
  assert.ok(knowledgeSources.every(source => source.provenance && source.text && /^KB-/.test(source.id)));
  assert.ok(localKnowledgePrompt().length < 14000);
  assert.doesNotMatch(localKnowledgePrompt(), /W25|W14|sk-[A-Za-z0-9]|https?:\/\//);
});
