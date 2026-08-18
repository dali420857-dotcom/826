import { createHash } from 'node:crypto';
import {
  approvalStillMatches,
  assertSafeCsvCell,
  inputLimits,
  type ApprovalBinding,
} from '../../contracts';
import {
  createRuntimeStore,
  type Clock,
  type OperationOutcome,
  type OperationResult,
} from '../../runtime-core';
import {
  approveDraftRequestSchema,
  createDraftRequestSchema,
  enqueueRequestSchema,
  importRequestSchema,
  operationMetadataSchema,
  reconcileRequestSchema,
  reviseDraftRequestSchema,
} from './schemas';

interface ContactRecord {
  readonly contactId: string;
  readonly email: string;
  readonly firstName: string;
  readonly company: string;
}

interface ImportRecord {
  readonly previewId: string;
  readonly contacts: readonly ContactRecord[];
}

export interface EmailTemplate {
  readonly subject: string;
  readonly htmlBody: string;
  readonly templateVersion: string;
  readonly variablesVersion: string;
}

interface DraftRecord {
  readonly draftId: string;
  readonly previewId: string;
  readonly targetContactIds: readonly string[];
  template: EmailTemplate;
  variables: Readonly<Record<string, string>>;
  stateVersion: number;
  approvedBinding?: ApprovalBinding;
}

export interface EmailQueueItem {
  readonly queueId: string;
  readonly draftId: string;
  readonly targetCount: number;
  readonly binding: ApprovalBinding;
  readonly queuedAt: string;
  readonly status: 'queued-local' | 'fake-failed' | 'reconciliation-required';
}

export type EmailAuditEvent = Readonly<
  {
    sequence: number;
    occurredAt: string;
    type:
      | 'email.import.previewed'
      | 'email.draft.created'
      | 'email.draft.revised'
      | 'email.draft.approved'
      | 'email.queue.completed'
      | 'email.queue.reconciled';
    count?: number;
    draftId?: string;
    operationId?: string;
    correlationId?: string;
    outcome?: OperationOutcome;
  }
>;

interface OperationMetadata {
  readonly operationId?: string;
  readonly correlationId?: string;
}

function parseOperationMetadata(metadata: OperationMetadata): OperationMetadata {
  const parsed = operationMetadataSchema.safeParse(metadata);
  if (!parsed.success) throw new Error('INVALID_OPERATION_METADATA');
  return parsed.data;
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('INVALID_EMAIL_IMPORT_CSV');
  row.push(cell.replace(/\r$/, ''));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function isSyntheticAddress(email: string): boolean {
  if (email.length > 320) return false;
  const match = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9.-]+)$/.exec(email);
  const [local, domain] = email.split('@');
  return Boolean(
    match?.[1]?.toLowerCase().endsWith('.example.test') &&
      local &&
      local.length <= 64 &&
      domain &&
      domain.length <= 253 &&
      domain.split('.').every((label) => label.length >= 1 && label.length <= 63),
  );
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local?.slice(0, 1) ?? '*'}***@${domain}`;
}

export function sanitizeEmailHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replace(/\r?\n/g, '<br>');
}

function sanitizeSubject(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

function render(value: string, variables: Readonly<Record<string, string>>): string {
  return value.replace(/{{\s*([A-Za-z][A-Za-z0-9_]{0,63})\s*}}/g, (_match, key: string) => {
    const replacement = variables[key];
    if (replacement === undefined) throw new Error('UNKNOWN_TEMPLATE_VARIABLE');
    return replacement;
  });
}

function safeVariables(input: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const output: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(input)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error('INVALID_TEMPLATE_VARIABLE');
    }
    output[key] = value;
  }
  return output;
}

export function createEmailOutreachModule(options: {
  readonly clock: Clock;
  readonly fakeOutcome?: () => OperationOutcome;
}) {
  const imports = new Map<string, ImportRecord>();
  const drafts = new Map<string, DraftRecord>();
  const queue = new Map<string, EmailQueueItem>();
  const queueByIdempotencyKey = new Map<string, string>();
  const pendingUnknownByDraftId = new Map<string, string>();
  const audit: EmailAuditEvent[] = [];
  const runtime = createRuntimeStore({ clock: options.clock, ttlMs: 60_000 });
  let auditSequence = 0;

  const appendAudit = (event: Omit<EmailAuditEvent, 'sequence' | 'occurredAt'>) => {
    audit.push({
      ...event,
      sequence: ++auditSequence,
      occurredAt: options.clock.now().toISOString(),
    });
  };

  const getDraft = (draftId: string): DraftRecord => {
    const draft = drafts.get(draftId);
    if (!draft) throw new Error('EMAIL_DRAFT_NOT_FOUND');
    return draft;
  };

  const assertNoPendingReconciliation = (draftId: string): void => {
    if (pendingUnknownByDraftId.has(draftId)) {
      throw new Error('RECONCILIATION_REQUIRED');
    }
  };

  const selectedContacts = (draft: DraftRecord): readonly ContactRecord[] => {
    const imported = imports.get(draft.previewId);
    if (!imported) throw new Error('EMAIL_PREVIEW_NOT_FOUND');
    const contactsById = new Map(imported.contacts.map((contact) => [contact.contactId, contact]));
    return draft.targetContactIds.map((id) => {
      const contact = contactsById.get(id);
      if (!contact) throw new Error('EMAIL_CONTACT_NOT_FOUND');
      return contact;
    });
  };

  const renderForContact = (draft: DraftRecord, contact: ContactRecord) => {
    const variables = safeVariables({
      ...draft.variables,
      firstName: contact.firstName,
      company: contact.company,
    });
    const subject = sanitizeSubject(render(draft.template.subject, variables));
    const htmlBody = sanitizeEmailHtml(render(draft.template.htmlBody, variables));
    if (!subject || subject.length > 500 || htmlBody.length > inputLimits.maxBodyCharacters * 6) {
      throw new Error('EMAIL_RENDER_LIMIT_EXCEEDED');
    }
    return { subject, htmlBody };
  };

  const renderDraft = (draft: DraftRecord) => renderForContact(draft, selectedContacts(draft)[0]!);

  const bindingFor = (draft: DraftRecord): ApprovalBinding => {
    const rendered = selectedContacts(draft).map((contact) => renderForContact(draft, contact));
    return {
      schemaVersion: 1,
      contentHash: hash(JSON.stringify(rendered)),
      templateVersion: draft.template.templateVersion,
      variablesVersion: draft.template.variablesVersion,
      targetSetHash: hash(JSON.stringify([...draft.targetContactIds].sort())),
      expectedStateVersion: draft.stateVersion,
    };
  };

  const publicDraft = (draft: DraftRecord) => {
    const binding = bindingFor(draft);
    return {
      draftId: draft.draftId,
      template: { ...draft.template },
      binding,
      renderedPreview: renderDraft(draft),
      targetCount: draft.targetContactIds.length,
      approvalStatus: draft.approvedBinding
        ? approvalStillMatches(draft.approvedBinding, binding)
          ? ('approved' as const)
          : ('stale' as const)
        : ('pending' as const),
    };
  };

  return {
    moduleId: 'email' as const,
    previewImport(input: unknown, metadata: OperationMetadata = {}) {
      const safeMetadata = parseOperationMetadata(metadata);
      const parsed = importRequestSchema.safeParse(input);
      if (!parsed.success) throw new Error('INVALID_EMAIL_IMPORT');
      if (new TextEncoder().encode(parsed.data.source.content).byteLength > inputLimits.maxImportBytes) {
        throw new Error('INVALID_EMAIL_IMPORT');
      }
      const rows = parseCsv(parsed.data.source.content);
      if (rows.length < 2 || rows.length - 1 > inputLimits.maxImportRows) {
        throw new Error('INVALID_EMAIL_IMPORT');
      }
      if (rows[0]?.join(',') !== 'email,firstName,company') {
        throw new Error('INVALID_EMAIL_IMPORT_HEADERS');
      }
      const contacts = rows.slice(1).map((cells, rowIndex): ContactRecord => {
        if (cells.length !== 3) throw new Error('INVALID_EMAIL_IMPORT_ROW');
        const [email = '', firstName = '', company = ''] = cells.map((value) => value.trim());
        if (!isSyntheticAddress(email)) throw new Error('NON_SYNTHETIC_CONTACT');
        if (!firstName || firstName.length > 200 || company.length > 200) {
          throw new Error('INVALID_EMAIL_IMPORT_ROW');
        }
        return {
          contactId: `email-contact-${hash(`${rowIndex}:${email.toLowerCase()}`).slice(0, 20)}`,
          email: email.toLowerCase(),
          firstName: assertSafeCsvCell(firstName),
          company: assertSafeCsvCell(company),
        };
      });
      const previewId = `email-preview-${hash(parsed.data.source.content).slice(0, 20)}`;
      imports.set(previewId, { previewId, contacts });
      appendAudit({
        type: 'email.import.previewed',
        count: contacts.length,
        operationId: safeMetadata.operationId,
        correlationId: safeMetadata.correlationId,
      });
      return {
        previewId,
        contacts: contacts.map((contact) => ({
          contactId: contact.contactId,
          maskedEmail: maskEmail(contact.email),
          firstName: contact.firstName,
          company: contact.company,
        })),
      };
    },
    createDraft(input: unknown, metadata: OperationMetadata = {}) {
      const safeMetadata = parseOperationMetadata(metadata);
      const result = createDraftRequestSchema.safeParse(input);
      if (!result.success) throw new Error('INVALID_EMAIL_DRAFT');
      const parsed = result.data;
      const imported = imports.get(parsed.previewId);
      if (!imported) throw new Error('EMAIL_PREVIEW_NOT_FOUND');
      const uniqueTargets = [...new Set(parsed.targetContactIds)];
      if (uniqueTargets.length !== parsed.targetContactIds.length) {
        throw new Error('DUPLICATE_EMAIL_TARGET');
      }
      const known = new Set(imported.contacts.map((contact) => contact.contactId));
      if (uniqueTargets.some((id) => !known.has(id))) throw new Error('EMAIL_CONTACT_NOT_FOUND');
      const draftId = `email-draft-${hash(
        JSON.stringify({
          previewId: parsed.previewId,
          uniqueTargets,
          template: parsed.template,
          variables: parsed.variables,
        }),
      ).slice(0, 20)}`;
      const draft: DraftRecord = {
        draftId,
        previewId: parsed.previewId,
        targetContactIds: uniqueTargets,
        template: { ...parsed.template },
        variables: safeVariables(parsed.variables),
        stateVersion: 1,
      };
      const view = publicDraft(draft);
      if (drafts.has(draftId)) throw new Error('EMAIL_DRAFT_ID_COLLISION');
      drafts.set(draftId, draft);
      appendAudit({
        type: 'email.draft.created',
        draftId,
        operationId: safeMetadata.operationId,
        correlationId: safeMetadata.correlationId,
      });
      return view;
    },
    reviseDraft(input: unknown, metadata: OperationMetadata = {}) {
      const safeMetadata = parseOperationMetadata(metadata);
      const result = reviseDraftRequestSchema.safeParse(input);
      if (!result.success) throw new Error('INVALID_EMAIL_DRAFT_REVISION');
      const parsed = result.data;
      const draft = getDraft(parsed.draftId);
      assertNoPendingReconciliation(draft.draftId);
      const candidate: DraftRecord = {
        ...draft,
        template: { ...parsed.template },
        variables: safeVariables(parsed.variables),
        stateVersion: draft.stateVersion + 1,
      };
      const view = publicDraft(candidate);
      draft.template = candidate.template;
      draft.variables = candidate.variables;
      draft.stateVersion = candidate.stateVersion;
      appendAudit({
        type: 'email.draft.revised',
        draftId: draft.draftId,
        operationId: safeMetadata.operationId,
        correlationId: safeMetadata.correlationId,
      });
      return view;
    },
    approveDraft(input: unknown, metadata: OperationMetadata = {}) {
      const safeMetadata = parseOperationMetadata(metadata);
      const result = approveDraftRequestSchema.safeParse(input);
      if (!result.success) throw new Error('INVALID_EMAIL_APPROVAL');
      const parsed = result.data;
      const draft = getDraft(parsed.draftId);
      assertNoPendingReconciliation(draft.draftId);
      const current = bindingFor(draft);
      if (!approvalStillMatches(parsed.binding, current)) throw new Error('APPROVAL_BINDING_MISMATCH');
      draft.approvedBinding = { ...parsed.binding };
      appendAudit({
        type: 'email.draft.approved',
        draftId: draft.draftId,
        operationId: safeMetadata.operationId,
        correlationId: safeMetadata.correlationId,
      });
      return { draftId: draft.draftId, approved: true as const, binding: current };
    },
    readDraft(draftId: string) {
      const draft = drafts.get(draftId);
      return draft ? publicDraft(draft) : undefined;
    },
    async enqueueLocal(
      input: unknown,
      metadata: OperationMetadata = {},
    ): Promise<OperationResult<EmailQueueItem>> {
      const safeMetadata = parseOperationMetadata(metadata);
      const result = enqueueRequestSchema.safeParse(input);
      if (!result.success) throw new Error('INVALID_EMAIL_ENQUEUE');
      const parsed = result.data;
      const draft = getDraft(parsed.draftId);
      const pendingUnknown = pendingUnknownByDraftId.get(draft.draftId);
      if (pendingUnknown && pendingUnknown !== parsed.idempotencyKey) {
        throw new Error('RECONCILIATION_REQUIRED');
      }
      if (!draft.approvedBinding) throw new Error('APPROVAL_REQUIRED');
      const current = bindingFor(draft);
      if (!approvalStillMatches(draft.approvedBinding, current)) throw new Error('APPROVAL_STALE');
      const payloadHash = hash(
        JSON.stringify({
          draftId: draft.draftId,
          approvedBinding: current,
        }),
      );
      return runtime.runOperation({
        operationId: parsed.operationId,
        idempotencyKey: parsed.idempotencyKey,
        payloadHash,
        execute: () => {
          const outcome = options.fakeOutcome?.() ?? 'success';
          const queueId = `email-queue-${hash(`${parsed.idempotencyKey}:${draft.draftId}`).slice(0, 20)}`;
          const item: EmailQueueItem = {
            queueId,
            draftId: draft.draftId,
            targetCount: draft.targetContactIds.length,
            binding: current,
            queuedAt: options.clock.now().toISOString(),
            status:
              outcome === 'success'
                ? 'queued-local'
                : outcome === 'failure'
                  ? 'fake-failed'
                  : 'reconciliation-required',
          };
          queue.set(queueId, item);
          queueByIdempotencyKey.set(parsed.idempotencyKey, queueId);
          if (outcome === 'unknown') {
            pendingUnknownByDraftId.set(draft.draftId, parsed.idempotencyKey);
          }
          appendAudit({
            type: 'email.queue.completed',
            draftId: draft.draftId,
            operationId: parsed.operationId,
            correlationId: safeMetadata.correlationId,
            outcome,
          });
          return { outcome, value: item };
        },
      });
    },
    reconcile(input: unknown, metadata: OperationMetadata = {}): OperationResult<EmailQueueItem> {
      const safeMetadata = parseOperationMetadata(metadata);
      const parsedResult = reconcileRequestSchema.safeParse(input);
      if (!parsedResult.success) throw new Error('INVALID_EMAIL_RECONCILIATION');
      const parsed = parsedResult.data;
      const queueId = queueByIdempotencyKey.get(parsed.targetIdempotencyKey);
      const existing = queueId ? queue.get(queueId) : undefined;
      if (!existing) throw new Error('EMAIL_QUEUE_ITEM_NOT_FOUND');
      if (pendingUnknownByDraftId.get(existing.draftId) !== parsed.targetIdempotencyKey) {
        throw new Error('EMAIL_RECONCILIATION_NOT_PENDING');
      }
      const item: EmailQueueItem = {
        ...existing,
        status: parsed.outcome === 'success' ? 'queued-local' : 'fake-failed',
      };
      const reconciled = runtime.reconcile({
        idempotencyKey: parsed.targetIdempotencyKey,
        outcome: parsed.outcome,
        value: item,
      });
      const draft = getDraft(existing.draftId);
      draft.stateVersion += 1;
      pendingUnknownByDraftId.delete(existing.draftId);
      queue.set(item.queueId, item);
      appendAudit({
        type: 'email.queue.reconciled',
        draftId: item.draftId,
        operationId: parsed.operationId,
        correlationId: safeMetadata.correlationId,
        outcome: parsed.outcome,
      });
      return reconciled;
    },
    readQueue: () => [...queue.values()].map((item) => ({ ...item, binding: { ...item.binding } })),
    readAudit: () => audit.map((event) => ({ ...event })),
  };
}
