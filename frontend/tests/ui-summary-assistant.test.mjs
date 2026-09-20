import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { z } from 'zod';
import * as replay from '../lib/rtdi/replay.ts';
import { translate } from '../lib/rtdi/locale.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const symbols = new Proxy({}, { get: (_, name) => name });
function harness(file, name, fetch = () => { throw Error('Unexpected request'); }) {
    const slots = [], effects = []; let cursor = 0, locale = 'en';
    const state = initial => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    };
    const hooks = { ...React, useState: state, useRef: initial => state(() => ({ current: initial }))[0],
        useEffect(fn, deps) {
            const index = cursor++, previous = slots[index];
            if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
                previous?.cleanup?.();
                const effect = { deps }; slots[index] = effect; effects.push(() => { effect.cleanup = fn(); });
            }
        } };
    const context = { exports: {}, fetch, AbortController, document: { getElementById: () => ({ focus() {} }) }, require(id) {
        if (id === 'react') return hooks;
        if (id === 'react/jsx-runtime') return jsxRuntime;
        if (id === 'zod') return { z };
        if (id === '@/components/locale-provider') return { useLocale: () => ({ locale, t: (text, ...args) => translate(locale, text, ...args), setLocale: value => { locale = value; } }) };
        if (id === '@/lib/rtdi/replay') return replay;
        if (id === '@/lib/rtdi/source-session') return { updateReplaySelection() {} };
        if (id === '@/lib/rtdi/local-knowledge') return { knowledgeSources: [] };
        if (id.endsWith('.css')) return {};
        if (id === 'lucide-react' || id.startsWith('@/components/')) return symbols;
        throw Error('Unexpected dependency: ' + id);
    } };
    const source = readFileSync(new URL('../components/' + file + '.tsx', import.meta.url), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    return { render(props) { cursor = 0; const tree = context.exports[name](props); while (effects.length) effects.shift()(); return tree; },
        unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
function find(node, predicate) {
    if (Array.isArray(node)) { for (const child of node) { const result = find(child, predicate); if (result) return result; } return; }
    if (!node || typeof node !== 'object') return;
    return predicate(node) ? node : find(node.props?.children, predicate);
}
const chat = tree => find(tree, node => node.type === 'SemiconductorChat');
const button = (tree, label) => find(tree, node => node.type === 'button' && node.props.children === label);

test('bundled and imported summaries mount a scope-free assistant beside the archive', () => {
    const data = JSON.parse(readFileSync(new URL('../public/replay/summary.json', import.meta.url), 'utf8'));
    for (const filename of ['summary.json', 'custom.json']) {
        const component = harness('imported-summary-workspace', 'ImportedSummaryWorkspace');
        const tree = component.render({ replay: { data, filename, selection: { waferId: '14', alertIndex: 0, filter: 'all', tab: 'analysis', detailOpen: true } }, onLoadBackend() { throw Error('Unexpected backend load'); } });
        const assistant = find(tree, node => node.type === 'SummaryAssistant');
        assert.ok(assistant); assert.deepEqual(Object.keys(assistant.props), []);
    }
});

test('summary Q&A needs model configuration but no database; scoped analysis stays disabled', async () => {
    const requests = [];
    const component = harness('summary-assistant', 'SummaryAssistant', async (url, options) => { requests.push({ url, options }); return Response.json({ openai_configured: true, backend_connected: false }); });
    assert.equal(chat(component.render()).props.enabled, false);
    await tick(); const tree = component.render();
    assert.equal(chat(tree).props.enabled, true);
    assert.equal(button(tree, 'Selected analysis').props.disabled, true);
    assert.equal(button(tree, 'Selected analysis').props.onClick, undefined);
    assert.equal(button(tree, 'Semiconductor Q&A').props['aria-pressed'], true);
    assert.deepEqual(requests.map(request => request.url), ['/api/config']);
    find(tree, node => node.type === 'select').props.onChange({ target: { value: 'zh-TW' } });
    assert.equal(chat(component.render()).props.language, 'zh-TW');
    component.unmount(); assert.equal(requests[0].options.signal.aborted, true);
});

test('missing, invalid and failed model configuration keep Q&A visible and retryable', async () => {
    for (const response of [() => Response.json({ openai_configured: false }), () => Response.json({ openai_configured: 'yes' }), () => new Response('', { status: 503 })]) {
        let calls = 0;
        const component = harness('summary-assistant', 'SummaryAssistant', async () => ++calls === 1 ? response() : Response.json({ openai_configured: true }));
        component.render(); await tick();
        const tree = component.render(); assert.equal(chat(tree).props.enabled, false);
        button(tree, 'Retry service check').props.onClick(); component.render(); await tick();
        assert.equal(chat(component.render()).props.enabled, true); assert.equal(calls, 2);
    }
});

test('late configuration cannot update an unmounted summary assistant', async () => {
    let finish;
    const component = harness('summary-assistant', 'SummaryAssistant', () => new Promise(resolve => { finish = resolve; }));
    component.render(); component.unmount(); finish(Response.json({ openai_configured: true })); await tick();
    assert.equal(chat(component.render()).props.enabled, false);
});

test('general Q&A submits only explicit questions and general history, with no archive or run context', async () => {
    const requests = [];
    const component = harness('semiconductor-chat', 'SemiconductorChat', async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return Response.json({ answer: 'A wafer contains dies.', knowledge_sources: [] }); });
    const props = { enabled: true, language: 'zh-TW' };
    let tree = component.render(props); assert.equal(requests.length, 0);
    find(tree, node => node.type === 'textarea').props.onChange({ target: { value: 'What is a wafer?' } });
    tree = component.render(props); assert.equal(requests.length, 0);
    find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await tick();
    assert.deepEqual(requests, [{ url: '/api/assistant', body: { mode: 'openai', topic: 'knowledge', language: 'zh-TW', question: 'What is a wafer?', history: [] } }]);
    tree = component.render(props);
    find(tree, node => node.type === 'textarea').props.onChange({ target: { value: 'And a test site?' } });
    find(component.render(props), node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await tick();
    assert.deepEqual(requests[1].body.history, [{ role: 'user', content: 'What is a wafer?' }, { role: 'assistant', content: 'A wafer contains dies.' }]);
    assert.deepEqual(Object.keys(requests[1].body).sort(), ['history', 'language', 'mode', 'question', 'topic']);
});
