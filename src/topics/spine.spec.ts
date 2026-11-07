import type { Citation, Gap, Paper, Question, Work } from '../model/types';
import { spineEdges } from './spine';

const q = (id: string) => ({ id }) as Question;
const g = (id: string, questionIds: string[]) => ({ id, questionIds }) as Gap;
const w = (id: string, gapIds: string[]) => ({ id, gapIds }) as Work;
const p = (id: string, workIds: string[], gapIds: string[] = [], questionIds: string[] = []) => ({ id, workIds, gapIds, questionIds }) as Paper;
const c = (id: string, paperId: string) => ({ id, paperId }) as Citation;

describe('spineEdges', () => {
  it('turns child-side links into upstream → downstream edges', () => {
    const edges = spineEdges({
      questions: [q('q1')],
      gaps: [g('g1', ['q1'])],
      work: [w('w1', ['g1'])],
      papers: [p('p1', ['w1'], ['g1'], ['q1'])],
      citations: [c('c1', 'p1')],
    });
    expect(edges).toEqual([
      { from: 'q1', to: 'g1', kind: 'question-gap' },
      { from: 'g1', to: 'w1', kind: 'gap-work' },
      { from: 'w1', to: 'p1', kind: 'work-paper' },
      { from: 'g1', to: 'p1', kind: 'gap-paper' },
      { from: 'q1', to: 'p1', kind: 'question-paper' },
      { from: 'p1', to: 'c1', kind: 'paper-citation' },
    ]);
  });

  it('drops links to records that are not in the spine', () => {
    const edges = spineEdges({ questions: [], gaps: [g('g1', ['q-other'])], work: [w('w1', ['g-other'])], papers: [], citations: [c('c1', 'p-other')] });
    expect(edges).toEqual([]);
  });
});
