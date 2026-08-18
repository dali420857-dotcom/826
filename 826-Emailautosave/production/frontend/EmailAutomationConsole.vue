<!--
  RETIREMENT MARKER — retired/disabled 2026-08-17.
  Historical artifact only. Do not import, mount, or add this SFC back to a
  DALI route. The active route was removed by explicit user request; keep this
  marker until a separately approved deletion or replacement decision exists.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { createLocalEmailAutomationService } from "../backend/local-service";

const service = createLocalEmailAutomationService();
const templateId = ref("welcome-v1");
const recipientPlaceholder = ref("CONTACT-001");
const subjectPreview = ref("合作機會｜本地合成預覽");
const bodyPreview = ref("您好，這是只供測試的合成草稿，不含真實郵件內容。");
const snapshot = ref(service.getSnapshot());
const message = ref("尚未建立草稿。");
const errorMessage = ref("");

const latestDraft = computed(() => snapshot.value.drafts.at(-1) ?? null);
const latestQueueItem = computed(() => snapshot.value.queue.at(-1) ?? null);

function refresh() {
  snapshot.value = service.getSnapshot();
}

function createDraft() {
  errorMessage.value = "";
  try {
    service.createDraft({
      templateId: templateId.value,
      recipientPlaceholder: recipientPlaceholder.value,
      subjectPreview: subjectPreview.value,
      bodyPreview: bodyPreview.value,
    });
    message.value = "草稿已建立，等待審閱。";
    refresh();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "InvalidDraft";
    message.value = "草稿未建立。";
  }
}

async function approveAndQueue() {
  if (!latestDraft.value) return;
  service.approveDraft(latestDraft.value.id, "local-reviewer");
  service.enqueueApprovedDraft(latestDraft.value.id);
  message.value = "已批准並加入本地隊列。";
  refresh();
  await service.processNext();
  refresh();
  message.value = latestQueueItem.value?.error
    ? `假發送失敗：${latestQueueItem.value.error}`
    : "Fake adapter 已接受命令；沒有傳送任何郵件。";
}

function queueStatusLabel(status: string) {
  return {
    queued: "隊列中",
    processing: "處理中",
    completed: "已完成（假發送）",
    failed: "失敗（未重試）",
  }[status] ?? status;
}
</script>

<template>
  <section class="email-console" aria-labelledby="email-console-title">
    <header class="email-console__header">
      <div>
        <span class="email-kicker">DALI AUTO MAIL · LOCAL ONLY</span>
        <h1 id="email-console-title">電郵自發控制台</h1>
        <p>模板、審閱、批准與隊列的本地 no-send 閉環。</p>
      </div>
      <div class="email-safety" role="status">
        <strong>Fake adapter</strong>
        <span>沒有連接真實 Mailspring、帳號或收件人</span>
      </div>
    </header>

    <div class="email-grid">
      <section class="email-panel" aria-labelledby="draft-title">
        <div class="email-panel__title">
          <span>01</span><h2 id="draft-title">模板與草稿</h2>
        </div>
        <label for="template-id">模板</label>
        <select id="template-id" v-model="templateId">
          <option value="welcome-v1">初次聯絡（合成）</option>
          <option value="followup-v1">跟進提醒（合成）</option>
        </select>
        <label for="recipient-placeholder">收件對象安全占位</label>
        <input id="recipient-placeholder" v-model="recipientPlaceholder" maxlength="80" />
        <label for="subject-preview">主旨預覽</label>
        <input id="subject-preview" v-model="subjectPreview" maxlength="160" />
        <label for="body-preview">內容預覽</label>
        <textarea id="body-preview" v-model="bodyPreview" rows="5" maxlength="4000" />
        <button type="button" @click="createDraft">建立本地草稿</button>
        <p v-if="errorMessage" class="email-error" role="alert">
          輸入未通過本地驗證：{{ errorMessage }}
        </p>
      </section>

      <section class="email-panel" aria-labelledby="review-title">
        <div class="email-panel__title">
          <span>02</span><h2 id="review-title">發送前審閱與批准</h2>
        </div>
        <template v-if="latestDraft">
          <dl class="email-review">
            <div><dt>草稿</dt><dd>{{ latestDraft.id }}</dd></div>
            <div><dt>對象</dt><dd>{{ latestDraft.recipientPlaceholder }}</dd></div>
            <div><dt>狀態</dt><dd>{{ latestDraft.status === "pending_review" ? "等待審閱" : latestDraft.status }}</dd></div>
          </dl>
          <button
            type="button"
            :disabled="latestDraft.status !== 'pending_review'"
            @click="approveAndQueue"
          >批准並加入隊列</button>
        </template>
        <p v-else class="email-empty">先建立草稿，批准按鈕才會啟用。</p>
        <p class="email-message" role="status">{{ message }}</p>
      </section>

      <section class="email-panel email-panel--wide" aria-labelledby="queue-title">
        <div class="email-panel__title">
          <span>03</span><h2 id="queue-title">隊列狀態與失敗提示</h2>
        </div>
        <table>
          <thead><tr><th>命令</th><th>草稿</th><th>狀態</th><th>回執／錯誤</th></tr></thead>
          <tbody>
            <tr v-for="item in snapshot.queue" :key="item.id">
              <td>{{ item.id }}</td><td>{{ item.draftId }}</td>
              <td>{{ queueStatusLabel(item.status) }}</td>
              <td>{{ item.error ?? item.receiptId ?? "—" }}</td>
            </tr>
            <tr v-if="snapshot.queue.length === 0"><td colspan="4">隊列目前為空。</td></tr>
          </tbody>
        </table>
        <p class="email-hint">失敗命令不會自動重試；必須先對帳並重新審批。</p>
      </section>

      <section class="email-panel email-panel--wide" aria-labelledby="audit-title">
        <div class="email-panel__title">
          <span>04</span><h2 id="audit-title">審計記錄</h2>
        </div>
        <ol class="email-audit">
          <li v-for="entry in snapshot.audit" :key="entry.id">
            <code>{{ entry.action }}</code><span>{{ entry.entityId }}</span><p>{{ entry.summary }}</p>
          </li>
          <li v-if="snapshot.audit.length === 0">尚無本地操作記錄。</li>
        </ol>
      </section>
    </div>
  </section>
</template>

<style scoped>
.email-console { color: #e8edf5; max-width: 1220px; margin: 0 auto; }
.email-console__header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 24px; }
.email-console h1 { margin: 6px 0; font-size: clamp(28px, 4vw, 42px); }
.email-console p { color: #97a4b7; }
.email-kicker { color: #43d6a0; font-size: 12px; letter-spacing: .14em; font-weight: 700; }
.email-safety { border: 1px solid #294439; background: #111d19; padding: 12px 16px; display: grid; gap: 4px; min-width: 290px; }
.email-safety span { color: #91b6a7; font-size: 13px; }
.email-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.email-panel { background: #111821; border: 1px solid #263241; padding: 20px; }
.email-panel--wide { grid-column: 1 / -1; }
.email-panel__title { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.email-panel__title > span { color: #43d6a0; font-family: ui-monospace, monospace; }
.email-panel h2 { margin: 0; font-size: 18px; }
.email-panel label { display: block; color: #b9c4d2; font-size: 13px; margin: 12px 0 6px; }
.email-panel input, .email-panel select, .email-panel textarea { width: 100%; box-sizing: border-box; color: #e8edf5; background: #0b1118; border: 1px solid #344257; padding: 10px 12px; font: inherit; }
.email-panel button { margin-top: 16px; background: #43d6a0; color: #07120e; border: 0; padding: 10px 16px; font-weight: 700; cursor: pointer; }
.email-panel button:disabled { background: #33404e; color: #8491a2; cursor: not-allowed; }
.email-review { display: grid; gap: 8px; }
.email-review div { display: flex; justify-content: space-between; border-bottom: 1px solid #263241; padding-bottom: 8px; }
.email-review dt { color: #8996a8; }.email-review dd { margin: 0; }
.email-message, .email-hint { border-left: 2px solid #43d6a0; padding-left: 10px; }
.email-error { border-left: 2px solid #ff6b6b; color: #ffb5b5 !important; padding-left: 10px; }
.email-panel table { width: 100%; border-collapse: collapse; font-size: 14px; }
.email-panel th, .email-panel td { text-align: left; border-bottom: 1px solid #263241; padding: 10px; }
.email-panel th { color: #8fa0b4; }.email-audit { padding: 0; list-style: none; display: grid; gap: 8px; }
.email-audit li { display: grid; grid-template-columns: 150px 110px 1fr; gap: 12px; align-items: baseline; border-bottom: 1px solid #263241; }
.email-audit code { color: #43d6a0; }.email-audit p { margin: 8px 0; }
@media (max-width: 820px) { .email-console__header { flex-direction: column; }.email-safety { min-width: 0; width: 100%; box-sizing: border-box; }.email-grid { grid-template-columns: 1fr; }.email-panel--wide { grid-column: auto; }.email-audit li { grid-template-columns: 1fr; gap: 2px; }.email-panel { overflow-x: auto; } }
</style>
