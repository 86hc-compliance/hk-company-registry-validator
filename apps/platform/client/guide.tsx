import { External, useT } from './common';
import { knowledge } from '../shared/knowledge';
export function Guide() {
  const t = useT();
  return (
    <section className="narrow section">
      <div className="eyebrow">A LITTLE PREPARATION GOES A LONG WAY</div>
      <h1>{t('開始之前，先有個方向。', 'A clear starting point.')}</h1>
      <p className="lead">{t(knowledge.boundary.zh, knowledge.boundary.en)}</p>
      {knowledge.topics.map((topic, i) => (
        <article className="editor-section" key={topic.id}>
          <div className="section-number">0{i + 1}</div>
          <h2>{t(topic.zh, topic.en)}</h2>
          <p>{t(topic.textZh, topic.textEn)}</p>
          <External href={topic.source}>{t('查看官方資料', 'Read the official guidance')}</External>
        </article>
      ))}
      <small className="muted">
        {t('參考整理日期', 'Reviewed')}: {knowledge.reviewedAt}.{' '}
        {t(
          '整理自開源合規指南並核對官方資料。',
          'Adapted from the open-source compliance guide and checked against official sources.',
        )}
      </small>
      <p>
        <External href={knowledge.upstream}>Awesome Hong Kong Corporate Compliance</External>
      </p>
    </section>
  );
}
