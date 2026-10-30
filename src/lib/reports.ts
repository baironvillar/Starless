import type { StringKey } from "./i18n";

/** What `submit_crash_report` and `submit_feedback` answer. Mirrors `report::ReportOutcome`. */
export type ReportOutcome = {
  /** Filed without leaving the app. `false` is the browser path: open `url`. */
  created: boolean;
  url: string;
  /** The same crash was already reported, and this one was added to it. */
  duplicate: boolean;
};

/**
 * The sentence for a report that did not go out.
 *
 * The two codes are the relay saying no, and they are not the same no: one
 * passes in an hour, the other will not pass by retrying. Anything else is a
 * failure the person cannot act on beyond trying again.
 */
export function reportErrorText(error: unknown, t: Record<StringKey, string>): string {
  if (error === "report_rate_limited") return t.reportRateLimited;
  if (error === "report_rejected") return t.reportRejected;
  return t.crashReportFailed;
}
