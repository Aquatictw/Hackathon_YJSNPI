import test from 'node:test';
import assert from 'node:assert/strict';
import {tourChapters, tourIndices, tourRoute, tourSource, tourSteps, tourWelcome} from '../lib/rtdi/tour-steps.ts';
import {zhTW} from '../lib/rtdi/locale-zh-TW.ts';

const chapter = (path, source) => tourIndices(path, source).map(i => tourSteps[i]).filter(step => step.route === tourRoute(path));

test('home and workspace share a chapter; Replay has its own route', () => {
  assert.equal(tourRoute('/'), '/workspace');
  assert.equal(tourRoute('/workspace/'), '/workspace');
  assert.equal(tourRoute('/replay/'), '/replay');
  assert.equal(tourRoute('/unknown'), null);
  assert.deepEqual(tourChapters.map(c => c.route), ['/replay', '/workspace', '/sandbox']);
  assert.deepEqual([...new Set(tourSteps.map(s => s.route))], tourChapters.map(c => c.route));
  assert.equal(tourSteps[0].id, 'analysis-load', 'Start tour opens Wafer Analysis from any page');
  assert.equal(new Set(tourSteps.map(s => s.id)).size, tourSteps.length);
  for (const c of tourChapters) assert.equal(tourSteps.find(s => s.route === c.route).source, undefined);
  for (const step of tourSteps) assert.equal(step.chapter, tourChapters.find(c => c.route === step.route).name);
});

test('workspace teaches Load before status, records and assistant; summary skips backend controls', () => {
  const backend = chapter('/', 'workspace-backend').map(s => s.id);
  assert.deepEqual(backend, ['workspace', 'load', 'stream', 'workspace-summary', 'evidence', 'temperature', 'commands', 'investigate', 'cost']);
  assert.deepEqual(chapter('/workspace', 'workspace-summary').map(s => s.id), ['workspace', 'load', 'workspace-import', 'workspace-import-views']);
  const load=tourSteps.find(step=>step.id==='load');
  for(const text of ['summary.json','Replay','Live','training','does not prove current machine activity','selecting an option alone does not load it'])assert.ok(load.body.includes(text),text);
  assert.ok(zhTW[load.body].includes('summary.json'));
});

test('Replay opens the stored picker and teaches the wafer overview before Workspace', () => {
  const backend = chapter('/replay', 'replay-backend');
  assert.deepEqual(backend.map(s => s.id), ['analysis-load', 'analysis-status', 'analysis-wafers', 'analysis-wafer-detail', 'analysis-wafer-scene', 'analysis-coverage', 'analysis-workspace']);
  assert.deepEqual(backend.map(s => s.target), ['.dc-run-picker', '.dc-loaded-run', '.analysis-wafer-grid', '.analysis-wafer-detail', '.wafer-scene', '.run-analysis-coverage', '.run-analysis-workspace-link']);
});

test('archive chapter shares the picker and teaches source, wafers, validation and Workspace', () => {
  const archive = chapter('/replay', 'replay-archive');
  assert.deepEqual(archive.map(s => s.id), ['analysis-load', 'archive-source', 'archive-wafers', 'archive-detail', 'archive-validation', 'archive-limitations', 'archive-workspace']);
  assert.deepEqual(archive.map(s => s.target), ['.dc-run-picker', '.replay-source', '.wafer-tiles', '.replay-detail', '.model-panel', '.limitations-panel', '.replay-tabs']);
  assert.match(archive[0].body, /choose a source, then press Load/);
  assert.match(archive[0].body, /Replay groups recorded Gemini runs, imported replays including training, and bundled summary.json/);
  assert.match(archive[0].body, /Live groups stored live-source scopes/);
  assert.match(archive[0].body, /never changes the source or loads data/);
  assert.ok(archive.filter(s => s.tab).every(s => s.tab.startsWith('.replay-tabs [role=') && /-trigger-(analysis|validation|limitations)/.test(s.tab)));
  assert.match(archive.at(-1).body, /Workspace follows its own saved source/);
  assert.deepEqual(chapter('/replay', null).map(s => s.id), ['analysis-load']);
});

test('source detection uses rendered archive before its shared backend wrapper', () => {
  const detect = (path, selectors) => tourSource(path, selector => selectors.includes(selector));
  assert.equal(detect('/replay', ['.run-analysis', '.replay-source']), 'replay-archive');
  assert.equal(detect('/replay/', ['.replay-source']), 'replay-archive');
  assert.equal(detect('/replay', ['.run-analysis']), 'replay-backend');
  assert.equal(detect('/replay', ['.dc-run-picker']), null);
  assert.equal(detect('/workspace', ['.isw-app']), 'workspace-summary');
  assert.equal(detect('/', []), 'workspace-backend');
  assert.equal(detect('/sandbox', ['.replay-source']), null);
});

test('source filtering keeps destination chapters for native navigation', () => {
  const workspace = tourIndices('/workspace', 'workspace-summary').map(i => tourSteps[i]);
  assert.equal(workspace.find(s => s.route === '/replay').id, 'analysis-load');
  assert.equal(workspace.find(s => s.route === '/sandbox').id, 'sandbox');
  for (const source of ['replay-backend', 'replay-archive']) {
    const steps = tourIndices('/replay', source).map(i => tourSteps[i]);
    const lastReplay = chapter('/replay', source).at(-1);
    assert.equal(steps[steps.indexOf(lastReplay) + 1].id, 'workspace', 'Next from either Replay source opens Workspace');
    assert.equal(steps[steps.findIndex(s => s.id === 'workspace') - 1], lastReplay, 'Back resolves the final compatible Replay step');
  }
  for (const source of ['workspace-backend', 'workspace-summary']) {
    const steps = tourIndices('/workspace', source).map(i => tourSteps[i]);
    const lastWorkspace = chapter('/workspace', source).at(-1);
    assert.equal(steps[steps.indexOf(lastWorkspace) + 1].id, 'sandbox');
    assert.equal(steps[steps.findIndex(s => s.id === 'sandbox') - 1], lastWorkspace, 'Back from Sandbox resumes the final compatible Workspace step');
  }
});

test('practice comes before advanced fixtures and describes all four examples', () => {
  const steps = chapter('/sandbox', null);
  assert.ok(steps.findIndex(s => s.id === 'practice') < steps.findIndex(s => s.id === 'fixtures'));
  for (const label of ['Healthy window', 'Site imbalance', 'Mean drift', 'Missing / late prediction data'])
    assert.ok(steps.find(s => s.id === 'practice').body.includes(label));
  assert.match(steps.find(s => s.id === 'practice-late').body, /stage 3 remains unavailable/);
  assert.equal(steps.at(-1).id, 'finish');
});

test('guide chapters, explanations, notices and progress are bilingual', () => {
  const copy = [tourWelcome, ...tourChapters.flatMap(c => [c.name, c.description])];
  for (const step of tourSteps) copy.push(step.chapter, step.title, step.body, step.detail, ...(step.preview ? [step.preview.label, ...step.preview.rows.flat()] : []));
  copy.push('Step {0} of {1} in this chapter', 'Close the guide and load a backend run to inspect this panel. No run is loaded by the guide.');
  for (const text of copy.filter(Boolean)) assert.ok(zhTW[text], text);
});
