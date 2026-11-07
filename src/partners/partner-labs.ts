import type { PaperListItemDto } from '../papers/papers.dto';
import type { PartnerLabDto, PartnerLabsDto, PartnerPaperDto } from './partners.dto';

type Paper = Pick<PaperListItemDto, 'id' | 'title' | 'venue' | 'published' | 'topic' | 'partners' | 'initiatedBy' | 'totals'>;

/** Rolls the caller's papers up per partner lab: what we wrote together, and who started each one. */
export function partnerLabs(papers: Paper[]): PartnerLabsDto {
  const joint = papers.filter((p) => p.partners.length);
  const byLab = new Map<string, Paper[]>();
  for (const p of joint) for (const lab of new Set(p.partners)) byLab.set(lab, [...(byLab.get(lab) ?? []), p]);

  const labs = [...byLab].map(([name, ps]) => lab(name, ps));
  labs.sort((a, b) => b.joint - a.joint || a.name.localeCompare(b.name));
  const byUs = joint.filter((p) => !p.initiatedBy).length;
  return { papers: papers.length, joint: joint.length, initiatedByUs: byUs, initiatedByPartners: joint.length - byUs, labs };
}

function lab(name: string, ps: Paper[]): PartnerLabDto {
  const papers = ps.map((p) => partnerPaper(name, p)).sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id));
  const count = (by: PartnerPaperDto['initiatedBy']) => papers.filter((p) => p.initiatedBy === by).length;
  const topics = new Map(ps.map((p) => [p.topic.id, p.topic]));
  return {
    name,
    joint: papers.length,
    initiatedByUs: count('us'),
    initiatedByThem: count('partner'),
    initiatedByOthers: count('other-partner'),
    citations: papers.reduce((s, p) => s + p.citations, 0),
    views: papers.reduce((s, p) => s + p.views, 0),
    topics: [...topics.values()].map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    lastPublished: papers[0].published,
    papers,
  };
}

function partnerPaper(lab: string, p: Paper): PartnerPaperDto {
  return {
    id: p.id,
    title: p.title,
    venue: p.venue,
    published: p.published,
    topic: { id: p.topic.id, name: p.topic.name },
    initiatedBy: !p.initiatedBy ? 'us' : p.initiatedBy === lab ? 'partner' : 'other-partner',
    initiator: p.initiatedBy ?? null,
    otherPartners: p.partners.filter((x) => x !== lab),
    citations: p.totals.citations,
    views: p.totals.views,
  };
}
