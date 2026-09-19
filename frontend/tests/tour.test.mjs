import test from 'node:test';
import assert from 'node:assert/strict';
import {tourChapters, tourIndices, tourRoute, tourSteps} from '../lib/rtdi/tour-steps.ts';
import {zhTW} from '../lib/rtdi/locale-zh-TW.ts';

const chapter = (path, source) => tourIndices(path, source).map(i => tourSteps[i]).filter(step => step.route === tourRoute(path));

test('home and workspace share a chapter; Replay has its own route', () => {
  assert.equal(tourRoute('/'), '/workspace');
  assert.equal(tourRoute('/workspace/'), '/workspace');
  assert.equal(tourRoute('/replay/'), '/replay');
  assert.equal(tourRoute('/unknown'), null);
  assert.deepEqual(tourChapters.map(c => c.route), ['/workspace', '/replay', '/sandbox']);
  assert.equal(new Set(tourSteps.map(s => s.id)).size, tourSteps.length);
  for (const c of tourChapters) assert.equal(tourSteps.find(s => s.route === c.route).source, undefined);
  for (const step of tourSteps) assert.equal(step.chapter, tourChapters.find(c => c.route === step.route).name);
});

test('workspace teaches Load before status, records and assistant; summary skips backend controls', () => {
  const backend = chapter('/', 'workspace-backend').map(s => s.id);
  assert.deepEqual(backend, ['workspace', 'load', 'stream', 'workspace-summary', 'evidence', 'temperature', 'commands', 'investigate', 'cost']);
  assert.deepEqual(chapter('/workspace', 'workspace-summary').map(s => s.id), ['workspace', 'load', 'workspace-import', 'workspace-import-views']);
});

test('Replay follows selected source, with source choice before load or import', () => {
  const backend = chapter('/replay', 'replay-backend');
  const archive = chapter('/replay', 'replay-archive');
  assert.deepEqual(backend.map(s => s.id), ['analysis-source', 'analysis-load', 'analysis-status', 'analysis-summary', 'analysis-evidence', 'analysis-coverage', 'analysis-temperature']);
  assert.equal(archive[0].id, 'analysis-source');
  assert.ok(archive.findIndex(s => s.id === 'import') < archive.findIndex(s => s.id === 'filter'));
  assert.ok(backend.every(s => s.source !== 'replay-archive'));
  assert.ok(archive.every(s => s.source !== 'replay-backend'));
  assert.equal(archive.at(-1).id, 'limitations');
});

test('source filtering keeps destination chapters for native navigation', () => {
  const workspace = tourIndices('/workspace', 'workspace-summary').map(i => tourSteps[i]);
  assert.equal(workspace.find(s => s.route === '/replay').id, 'analysis-source');
  assert.equal(workspace.find(s => s.route === '/sandbox').id, 'sandbox');
  const backend = chapter('/replay', 'replay-backend');
  assert.equal(backend.at(-1).id, 'analysis-temperature', 'Back from Sandbox resumes the final compatible Replay step');
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
  const copy = tourChapters.flatMap(c => [c.name, c.description]);
  for (const step of tourSteps) copy.push(step.chapter, step.title, step.body, step.detail, ...(step.preview ? [step.preview.label, ...step.preview.rows.flat()] : []));
  copy.push('Step {0} of {1} in this chapter', 'Close the guide and load a backend run to inspect this panel. No run is loaded by the guide.');
  for (const text of copy.filter(Boolean)) assert.ok(zhTW[text], text);
});
