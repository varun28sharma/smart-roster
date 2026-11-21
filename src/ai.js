// Conflict explanations: Claude via /api/explain when deployed with a key,
// otherwise a deterministic template built from the same facts.

export async function explainIssue(issue, fixes, context) {
  try {
    const res = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issue: { type: issue.type, severity: issue.severity, title: issue.title, detail: issue.detail, hint: issue.hint },
        fixes: fixes.map((f) => ({ label: f.label, detail: f.detail, impact: f.impact })),
        context,
      }),
    });
    if (res.ok) {
      const j = await res.json();
      if (j.text) return { text: j.text, source: 'Claude' };
    }
  } catch {
    /* fall through to local explanation */
  }
  return { text: localExplanation(issue, fixes), source: 'rule-based (AI not configured)' };
}

function localExplanation(issue, fixes) {
  const best = fixes.find((f) => f.impact?.errors < 0) || fixes[0];
  const why = {
    GAP: 'A required process has fewer people working than its minimum, because the assigned staff are off, on leave or on a holiday that day.',
    MULTI_BRAND: 'One person carries processes for several brands, so a single absence hits all of them at once.',
    NO_WEEKLY_OFF: 'Every day of the week is needed to keep this person’s processes covered, and no qualified, shift-compatible colleague had spare capacity.',
    UNSTAFFED: 'The process is active but nobody is assigned to it.',
    COVER_INVALID: 'A cover was planned with someone who is no longer available, or who works a different shift.',
    OVERLOAD: 'This person was given more covers than their daily limit.',
    LONG_STREAK: 'Weekly offs fell far apart, creating a long run of working days.',
  }[issue.type] || '';
  return [
    issue.title + '.',
    issue.detail,
    why,
    best ? `Recommended: ${best.label} (${best.detail}).` : 'No internal fix is available: approve overtime, add a backup assignment, or agree reduced coverage with the client.',
  ].filter(Boolean).join('\n\n');
}
