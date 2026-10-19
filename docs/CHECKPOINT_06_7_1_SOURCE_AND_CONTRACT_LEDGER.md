# سجل المصدر والعقود — Checkpoint 06.7.1

- الجذر المؤكد: `I:\WORK\InjazDocs`. Node v24.19.0. الأوامر: `tsc -b`، `oxlint`، `vitest run`، `vite build`، `playwright test`.
- الحزمة: React 19، Vite 7.3.7، Tailwind v4 في `src/index.css`، Hono، Better Auth، D1.
- الغلاف: `src/app/shell.tsx`. اللوحة: `src/features/dashboard/DashboardPage.tsx` → `GET /api/v1/dashboard`. القائمة: `src/features/cases/CasesPages.tsx` `CasesListPage` → `GET /api/v1/export-cases?q=`.
- أعداد اللوحة من الخادم مع `caseVisibilitySql`: total_cases، completed، docs_pending، bank_pending، courier_open، overdue. due[24] وrecent[12].
- حقول القائمة: id، case_reference، status، document_route، bank_path_status، direct_path_status، destination_country، next_action، updated_at، assigned_to، customer_name، invoice_numbers. لا UCR ولا حالة بضاعة ولا نسبة إنجاز.
- اختبار قديم كان يفتح `.wrangler/state`. أُزيل. الحارس `shared/isolation.ts` يرمي `DEVELOPER_STATE_FORBIDDEN` قبل أي تنفيذ Wrangler على ذلك المسار.
- الخط: Segoe UI / Noto Sans Arabic / Tahoma. لا woff2. 21st.dev أُتيح للبحث؛ النتائج رسوم اتجاهات مرفوضة. Mobbin: يحتاج خطة مدفوعة.
