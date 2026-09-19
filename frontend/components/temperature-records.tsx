'use client';
import type { predictionRows } from '@/lib/rtdi/ui-predictions';
import {useLocale} from "@/components/locale-provider";
import { displayNumber } from '@/lib/rtdi/ui-presentation';

type Prediction = ReturnType<typeof predictionRows>[number];
const responseLabels = { not_requested: 'Not requested', insufficient_data: 'Insufficient data', response_queued: 'Response queued · tester unconfirmed', tester_confirmed: 'Source reports tester confirmation', unknown: 'Unknown' };

export function TemperatureRecords({ predictions }: { predictions: Prediction[] }) {
 const {t, locale} = useLocale();

  const matched = predictions.filter(row => row.prediction != null && row.actual != null).length;
  return <section className="dc-temperature" aria-labelledby="temperature-heading">
    <div className="dc-temperature-heading">
      <div><h3 id="temperature-heading">{t("Temperature prediction vs actual")}</h3><p>{t("Compare the model estimate with the uniquely matched measurement for each stage and site.")}</p></div>
      <span>{matched} / {predictions.length} {t("matched")}</span>
    </div>
    <div className="dc-temperature-key"><span><i className="estimate"/>{t("Predicted")}</span><span><i className="measured"/>{t("Actual")}</span><span>{t("Difference = predicted − actual")}</span></div>
    <div className="dc-table-wrap" tabIndex={0} role="region" aria-label={t("Temperature records, horizontally scrollable")}>
      <table className="dc-temperature-table"><thead><tr><th scope="col">{t("Stage / Site")}</th><th scope="col">{t("Predicted")}</th><th scope="col">{t("Actual")}</th><th scope="col">{t("Difference")}</th><th scope="col">{t("Record details")}</th></tr></thead>
        <tbody>{predictions.map(row => {
          const difference = row.prediction == null || row.actual == null ? undefined : row.prediction - row.actual;
          return <tr key={row.event_id}>
            <th scope="row"><strong>{t("Stage")}{row.stage ?? '—'}</strong><span>{t("Site")}{row.site_id ?? '—'}</span></th>
            <td className="dc-temperature-estimate"><strong className="dc-temperature-value" title={t("Exact prediction: {0}", row.prediction ?? t("Not provided"))}>{row.prediction == null ? '—' : displayNumber(row.prediction)}</strong><small>{row.unit ?? t("Unit unconfirmed")}</small></td>
            <td className="dc-temperature-actual"><strong className="dc-temperature-value" title={t("Exact actual: {0}", row.actual ?? t("Not provided"))}>{row.actual == null ? '—' : displayNumber(row.actual)}</strong><small>{row.actual_status ? t(row.actual_status === '實測衝突' ? 'Conflicting actuals' : 'Ambiguous actual scope') : row.actual == null ? t("Awaiting measurement") : row.unit ?? t("Unit unconfirmed")}</small></td>
            <td><strong className="dc-temperature-difference" title={t("Exact difference: {0}", difference ?? t("Not available"))}>{difference === undefined ? '—' : `${difference > 0 ? '+' : ''}${displayNumber(difference)}`}</strong><small>{difference === undefined ? t("No matched pair") : t("Predicted − actual")}</small></td>
            <td><details><summary>{t("Device & provenance")}</summary><small>{t("Device:")}{row.device_id ?? t("Not provided")}</small><small>{t("Site request:")}{row.request_id ?? t("Not provided")}</small><small>{t("Original request:")}{row.original_request_id ?? t("Not provided")}</small><small>{t("Source event:")}{row.source_event_id ?? t("Not provided")}</small><small>{t("Exact prediction:")}{row.prediction ?? t("Not provided")}</small><small>{t("Exact actual:")}{row.actual ?? t("Not provided")}</small><small>{t("Feature coverage:")}{row.coverage === undefined ? t("Not provided") : `${(row.coverage * 100).toFixed(0)}%`}</small><small>{t("Response:")}{t(responseLabels[row.response_status ?? 'unknown'])}</small><small>{t("Receipt:")}{row.tester_receipt_id ?? t("No receipt provided")}</small></details></td>
          </tr>;
        })}</tbody>
      </table>
      {!predictions.length && <div className="dc-empty"><h3>{t("No temperature records")}</h3><p>{t("Load a run with temperature predictions to compare measurements.")}</p></div>}
    </div>
    <p className="dc-temperature-note">{t("Values use source units; unconfirmed units are not assumed to be °C. Feature coverage is not accuracy. No acceptance tolerance has been established.")}</p>
  </section>;
}
