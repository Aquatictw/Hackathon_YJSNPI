import type { predictionRows } from '@/lib/rtdi/ui-predictions';
import { displayNumber } from '@/lib/rtdi/ui-presentation';

type Prediction = ReturnType<typeof predictionRows>[number];
const responseLabels = { not_requested: 'Not requested', insufficient_data: 'Insufficient data', response_queued: 'Response queued · tester unconfirmed', tester_confirmed: 'Source reports tester confirmation', unknown: 'Unknown' };

export function TemperatureRecords({ predictions }: { predictions: Prediction[] }) {
  const matched = predictions.filter(row => row.prediction != null && row.actual != null).length;
  return <section className="dc-temperature" aria-labelledby="temperature-heading">
    <div className="dc-temperature-heading">
      <div><h3 id="temperature-heading">Temperature prediction vs actual</h3><p>Compare the model estimate with the uniquely matched measurement for each stage and site.</p></div>
      <span>{matched} / {predictions.length} matched</span>
    </div>
    <div className="dc-temperature-key"><span><i className="estimate"/>Predicted</span><span><i className="measured"/>Actual</span><span>Difference = predicted − actual</span></div>
    <div className="dc-table-wrap" tabIndex={0} role="region" aria-label="Temperature records, horizontally scrollable">
      <table className="dc-temperature-table"><thead><tr><th scope="col">Stage / Site</th><th scope="col">Predicted</th><th scope="col">Actual</th><th scope="col">Difference</th><th scope="col">Record details</th></tr></thead>
        <tbody>{predictions.map(row => {
          const difference = row.prediction == null || row.actual == null ? undefined : row.prediction - row.actual;
          return <tr key={row.event_id}>
            <th scope="row"><strong>Stage {row.stage ?? '—'}</strong><span>Site {row.site_id ?? '—'}</span></th>
            <td className="dc-temperature-estimate"><strong className="dc-temperature-value" title={`Exact prediction: ${row.prediction ?? 'Not provided'}`}>{row.prediction == null ? '—' : displayNumber(row.prediction)}</strong><small>{row.unit ?? 'Unit unconfirmed'}</small></td>
            <td className="dc-temperature-actual"><strong className="dc-temperature-value" title={`Exact actual: ${row.actual ?? 'Not provided'}`}>{row.actual == null ? '—' : displayNumber(row.actual)}</strong><small>{row.actual_status ? (row.actual_status === '實測衝突' ? 'Conflicting actuals' : 'Ambiguous actual scope') : row.actual == null ? 'Awaiting measurement' : row.unit ?? 'Unit unconfirmed'}</small></td>
            <td><strong className="dc-temperature-difference" title={`Exact difference: ${difference ?? 'Not available'}`}>{difference === undefined ? '—' : `${difference > 0 ? '+' : ''}${displayNumber(difference)}`}</strong><small>{difference === undefined ? 'No matched pair' : 'Predicted − actual'}</small></td>
            <td><details><summary>Device & provenance</summary><small>Device: {row.device_id ?? 'Not provided'}</small><small>Site request: {row.request_id ?? 'Not provided'}</small><small>Original request: {row.original_request_id ?? 'Not provided'}</small><small>Source event: {row.source_event_id ?? 'Not provided'}</small><small>Exact prediction: {row.prediction ?? 'Not provided'}</small><small>Exact actual: {row.actual ?? 'Not provided'}</small><small>Feature coverage: {row.coverage === undefined ? 'Not provided' : `${(row.coverage * 100).toFixed(0)}%`}</small><small>Response: {responseLabels[row.response_status ?? 'unknown']}</small><small>Receipt: {row.tester_receipt_id ?? 'No receipt provided'}</small></details></td>
          </tr>;
        })}</tbody>
      </table>
      {!predictions.length && <div className="dc-empty"><h3>No temperature records</h3><p>Load a run with temperature predictions to compare measurements.</p></div>}
    </div>
    <p className="dc-temperature-note">Values use source units; unconfirmed units are not assumed to be °C. Feature coverage is not accuracy. No acceptance tolerance has been established.</p>
  </section>;
}
