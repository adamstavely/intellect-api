import type { Citation, Gap, Paper, Question, Work } from '../model/types';
import type { SpineEdgeKind } from './topics.dto';

export interface SpineRecords {
  questions: Question[];
  gaps: Gap[];
  work: Work[];
  papers: Paper[];
  citations: Citation[];
}

export interface SpineEdge {
  from: string;
  to: string;
  kind: SpineEdgeKind;
}

/**
 * Turns the child-side links into upstream → downstream edges. A link whose other end isn't in
 * `records` (another topic, or a dangling id) is dropped.
 */
export function spineEdges({ questions, gaps, work, papers, citations }: SpineRecords): SpineEdge[] {
  const has = (xs: { id: string }[]) => {
    const ids = new Set(xs.map((x) => x.id));
    return (id: string) => ids.has(id);
  };
  const isQuestion = has(questions);
  const isGap = has(gaps);
  const isWork = has(work);
  const isPaper = has(papers);

  const edges: SpineEdge[] = [];
  for (const g of gaps) for (const q of g.questionIds) if (isQuestion(q)) edges.push({ from: q, to: g.id, kind: 'question-gap' });
  for (const w of work) for (const g of w.gapIds) if (isGap(g)) edges.push({ from: g, to: w.id, kind: 'gap-work' });
  for (const p of papers) {
    for (const w of p.workIds) if (isWork(w)) edges.push({ from: w, to: p.id, kind: 'work-paper' });
    for (const g of p.gapIds) if (isGap(g)) edges.push({ from: g, to: p.id, kind: 'gap-paper' });
    for (const q of p.questionIds) if (isQuestion(q)) edges.push({ from: q, to: p.id, kind: 'question-paper' });
  }
  for (const c of citations) if (isPaper(c.paperId)) edges.push({ from: c.paperId, to: c.id, kind: 'paper-citation' });
  return edges;
}
