import type {
  EmailAuditReadback,
  EmailDraftView,
  EmailImportPreview,
  SyntheticEmailOutcome,
} from './types';

export function ContactPreview({ preview }: { preview?: EmailImportPreview }) {
  return (
    <section aria-labelledby="email-contacts-title" className="email-panel">
      <div className="email-panel__heading">
        <div><span>01</span><h3 id="email-contacts-title">合成聯絡人</h3></div>
        <strong>{preview ? `${preview.contacts.length} 筆` : '尚未載入'}</strong>
      </div>
      {preview ? (
        <ul className="email-contact-list">
          {preview.contacts.map((contact) => (
            <li key={contact.contactId}>
              <span>{contact.firstName}</span>
              <code>{contact.maskedEmail}</code>
              <small>{contact.company}</small>
            </li>
          ))}
        </ul>
      ) : <p className="email-helper">只接受內建 `.example.test` fixture，不提供檔案或真實名單入口。</p>}
    </section>
  );
}

export function DraftStatus({ draft, editorDirty = false }: { draft?: EmailDraftView; editorDirty?: boolean }) {
  const label = editorDirty
    ? '未儲存變更'
    : !draft
    ? '尚未建立'
    : draft.approvalStatus === 'approved'
      ? '已批准'
      : draft.approvalStatus === 'stale'
        ? '批准已失效'
        : '待審核';
  return (
    <div className={`email-draft-state email-draft-state--${editorDirty ? 'dirty' : draft?.approvalStatus ?? 'empty'}`}>
      <span>草稿狀態</span><strong>{label}</strong>
      {draft ? <small>state v{draft.binding.expectedStateVersion} · targets {draft.targetCount}</small> : null}
    </div>
  );
}

export function OutcomeControl({
  value,
  disabled,
  onChange,
}: {
  value: SyntheticEmailOutcome;
  disabled: boolean;
  onChange: (value: SyntheticEmailOutcome) => void;
}) {
  return (
    <label className="email-field">
      <span>合成結果</span>
      <select disabled={disabled} onChange={(event) => onChange(event.target.value as SyntheticEmailOutcome)} value={value}>
        <option value="success">success · 本機成功</option>
        <option value="failure">failure · 本機失敗</option>
        <option value="unknown">unknown · 需要對帳</option>
      </select>
    </label>
  );
}

export function AuditPanel({ audit }: { audit: EmailAuditReadback }) {
  return (
    <section aria-label="Email 稽核記錄" className="email-panel email-audit">
      <div className="email-panel__heading"><div><span>04</span><h3>稽核記錄</h3></div><strong>{audit.length} events</strong></div>
      {audit.length ? (
        <ol>
          {[...audit].reverse().map((event) => (
            <li key={event.sequence}>
              <code>#{event.sequence}</code><strong>{event.type}</strong>
              <span>{event.operationId ?? 'local-read'}</span>
            </li>
          ))}
        </ol>
      ) : <p className="email-helper">尚無 transition。所有記錄只含遮蔽 metadata。</p>}
    </section>
  );
}
